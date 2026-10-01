'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import {
  canonicalSpec,
  composeReferencePrompt,
  LIVE_MODEL_JOB_STATUSES,
  specForPreset,
  STRUCTURE_DEFINITIONS,
  STRUCTURE_FINISHES,
  SymbolIdSchema,
  type ModelAssetSpec,
  type ModelGenerationRequest,
  type ModelJob,
  type ModelLabStatus,
  type ModelReference,
  type RoofKind,
  type StructureFinishId,
} from '@garden-studio/schema';
import {
  cancelJob,
  jobFileUrl,
  labJob,
  labJobs,
  labReferences,
  labStatus,
  publishJob,
  referenceImageUrl,
  rejectJob,
  requestModel,
} from '@/lib/model-lab-api';

const ModelPreview = dynamic(() => import('./ModelPreview').then((module) => module.ModelPreview), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse bg-slate-100" />,
});

/** How often the lab asks about live jobs. The API asks Meshy at most every five seconds anyway. */
const POLL_MS = 4_000;

interface Loaded {
  status: ModelLabStatus;
  jobs: ModelJob[];
}

/** The lab's state from the API. Asking about a live job is what moves it along, so each is asked. */
async function loadLab(): Promise<Loaded> {
  const [status, jobs] = await Promise.all([labStatus(), labJobs()]);
  const advanced = await Promise.all(
    jobs.map((job) => (LIVE_MODEL_JOB_STATUSES.includes(job.status) ? labJob(job.id) : job)),
  );
  return { status, jobs: advanced };
}

/**
 * The model lab: asking for a library model, watching Meshy make it, and approving it into the
 * library. Development only, and a working tool rather than a product screen — see "Library models
 * from Meshy" in CLAUDE.md.
 *
 * It is careful about one thing above all, which is money: the generate button says what it costs,
 * is disabled while generation is off, and a request the library or a live job already answers is
 * answered without spending. Everything that decides that lives in the API; this page only shows it.
 */
export function ModelLab() {
  const [status, setStatus] = useState<ModelLabStatus | null>(null);
  const [references, setReferences] = useState<ModelReference[]>([]);
  const [jobs, setJobs] = useState<ModelJob[]>([]);
  const [offline, setOffline] = useState<string | null>(null);

  const apply = useCallback((loaded: Loaded) => {
    setStatus(loaded.status);
    setJobs(loaded.jobs);
    setOffline(null);
  }, []);
  const fail = useCallback((error: unknown) => setOffline((error as Error).message), []);
  const refresh = useCallback(() => {
    loadLab().then(apply, fail);
  }, [apply, fail]);

  useEffect(() => {
    loadLab().then(apply, fail);
    labReferences().then(setReferences, () => setReferences([]));
  }, [apply, fail]);

  const anyLive = jobs.some((job) => LIVE_MODEL_JOB_STATUSES.includes(job.status));
  useEffect(() => {
    if (!anyLive) return;
    const timer = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(timer);
  }, [anyLive, refresh]);

  return (
    <main
      data-testid="model-lab"
      className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8 text-garden-ink"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-garden-forest">Model lab</h1>
        <p className="text-sm text-garden-muted">
          Library models from Meshy: ask, watch, review, publish. Development only — published files
          land in <code>apps/web/public/models/</code> for you to review and commit.
        </p>
      </header>

      <StatusBar status={status} offline={offline} />
      <RequestForm status={status} references={references} onRequested={refresh} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-garden-forest">Jobs</h2>
        {jobs.length === 0 ? (
          <p className="text-sm text-garden-muted">Nothing has been asked for yet.</p>
        ) : (
          jobs.map((job) => <JobCard key={job.id} job={job} onChanged={refresh} />)
        )}
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ status */

function StatusBar({ status, offline }: { status: ModelLabStatus | null; offline: string | null }) {
  if (offline) {
    return (
      <Note tone="warn" testId="model-lab-status">
        The API did not answer ({offline}). Start it with{' '}
        <code>pnpm --filter @garden-studio/api dev</code>.
      </Note>
    );
  }
  if (!status) return <Note testId="model-lab-status">Asking the API…</Note>;
  const credits = `${status.creditsThisMonth} of ${status.ceiling} credits this month · ${status.inFlight} of ${status.maxInFlight} in flight · ${status.aiModel}`;
  return status.available ? (
    <Note tone="ok" testId="model-lab-status">
      Generation is on · {credits}
    </Note>
  ) : (
    <Note tone="warn" testId="model-lab-status">
      Generation is off: {status.reason} · {credits}
    </Note>
  );
}

/* ------------------------------------------------------------------ asking */

interface FormState {
  symbol: string;
  preset: string;
  frame: string;
  roofKind: string;
  roofFinish: string;
  width: string;
  depth: string;
  height: string;
  notes: string;
}

const SYMBOLS = Object.keys(STRUCTURE_DEFINITIONS);

function defaultsFor(symbol: string, preset?: string): FormState {
  const definition = STRUCTURE_DEFINITIONS[SymbolIdSchema.parse(symbol)]!;
  const chosen = preset ?? definition.presets[0]!.id;
  const spec = specForPreset(SymbolIdSchema.parse(symbol), chosen);
  return {
    symbol,
    preset: chosen,
    frame: '',
    roofKind: '',
    roofFinish: '',
    width: String(spec.nominal.width),
    depth: String(spec.nominal.depth),
    height: String(spec.nominal.height),
    notes: '',
  };
}

function specOf(form: FormState): { spec: ModelAssetSpec | null; error: string | null } {
  try {
    const symbol = SymbolIdSchema.parse(form.symbol);
    const nominal = {
      width: Number(form.width),
      depth: Number(form.depth),
      height: Number(form.height),
    };
    return {
      spec: specForPreset(symbol, form.preset, {
        ...(form.frame ? { frame: form.frame as StructureFinishId } : {}),
        ...(form.roofKind ? { roofKind: form.roofKind as RoofKind } : {}),
        ...(form.roofFinish ? { roofFinish: form.roofFinish as StructureFinishId } : {}),
        nominal,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      }),
      error: null,
    };
  } catch (error) {
    return { spec: null, error: (error as Error).message };
  }
}

/** The command that draws a reference for exactly this spec. */
function referenceCommand(form: FormState): string {
  const flags = [
    `--symbol ${form.symbol}`,
    `--preset ${form.preset}`,
    form.frame && `--frame ${form.frame}`,
    form.roofKind && `--roof-kind ${form.roofKind}`,
    form.roofFinish && `--roof-finish ${form.roofFinish}`,
    `--size ${form.width}x${form.depth}x${form.height}`,
    form.notes.trim() && `--notes "${form.notes.trim().replace(/"/g, '\\"')}"`,
  ].filter(Boolean);
  return `pnpm --filter @garden-studio/asset-tool generate:references ${flags.join(' ')}`;
}

type Reference =
  { kind: 'generated'; name: string } | { kind: 'upload'; dataUrl: string; fileName: string };

function RequestForm({
  status,
  references,
  onRequested,
}: {
  status: ModelLabStatus | null;
  references: ModelReference[];
  onRequested: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => defaultsFor('gazebo'));
  const [reference, setReference] = useState<Reference | null>(null);
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  const definition = STRUCTURE_DEFINITIONS[SymbolIdSchema.parse(form.symbol)]!;
  const { spec, error } = useMemo(() => specOf(form), [form]);
  const canonical = spec ? canonicalSpec(spec) : null;
  const matching = references.filter((candidate) => canonicalSpec(candidate.spec) === canonical);
  // A generated reference drawn for a different spec no longer applies once the form moves on.
  const chosen =
    reference?.kind === 'generated' &&
    !matching.some((candidate) => candidate.name === reference.name)
      ? null
      : reference;

  const set = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setAnswer(null);
  };

  const submit = async () => {
    if (!chosen || !spec) return;
    setBusy(true);
    setAnswer(null);
    const body: ModelGenerationRequest = {
      symbol: form.symbol,
      preset: form.preset,
      ...(form.frame ? { frame: form.frame } : {}),
      ...(form.roofKind ? { roofKind: form.roofKind } : {}),
      ...(form.roofFinish ? { roofFinish: form.roofFinish } : {}),
      size: spec.nominal,
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      reference:
        chosen.kind === 'generated'
          ? { kind: 'generated', name: chosen.name }
          : { kind: 'upload', dataUrl: chosen.dataUrl },
      force,
    };
    try {
      const result = await requestModel(body);
      setAnswer(
        result.kind === 'reused'
          ? {
              tone: 'ok',
              text: `The library already has this: ${result.assetId}. Nothing was spent.`,
            }
          : result.kind === 'existing'
            ? {
                tone: 'ok',
                text: 'A job for exactly this is already under way. Nothing was spent.',
              }
            : { tone: 'ok', text: 'Asked Meshy. It usually takes two to four minutes.' },
      );
      onRequested();
    } catch (failure) {
      setAnswer({ tone: 'warn', text: (failure as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const upload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () =>
      setReference({ kind: 'upload', dataUrl: String(reader.result), fileName: file.name });
    reader.readAsDataURL(file);
  };

  const finishOptions = (ids: readonly string[]) =>
    ids.map((id) => (
      <option key={id} value={id}>
        {STRUCTURE_FINISHES[id as StructureFinishId]?.label ?? id}
      </option>
    ));

  return (
    <section className="grid gap-5 rounded-xl border border-garden-line bg-white p-5 lg:grid-cols-[1fr_1fr]">
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-garden-forest">Ask for a model</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Structure">
            <select
              data-testid="model-lab-symbol"
              value={form.symbol}
              onChange={(event) => {
                setForm(defaultsFor(event.target.value));
                setReference(null);
              }}
            >
              {SYMBOLS.map((symbol) => (
                <option key={symbol} value={symbol}>
                  {STRUCTURE_DEFINITIONS[SymbolIdSchema.parse(symbol)]!.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Preset">
            <select
              data-testid="model-lab-preset"
              value={form.preset}
              onChange={(event) =>
                setForm({ ...defaultsFor(form.symbol, event.target.value), notes: form.notes })
              }
            >
              {definition.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Frame">
            <select
              data-testid="model-lab-frame"
              value={form.frame}
              onChange={(event) => set({ frame: event.target.value })}
            >
              <option value="">As the preset</option>
              {finishOptions(definition.frameMaterials)}
            </select>
          </Field>
          <Field label="Roof">
            <select
              value={form.roofKind}
              onChange={(event) => set({ roofKind: event.target.value })}
            >
              <option value="">As the preset</option>
              {definition.roof?.kinds.map((kind) => (
                <option key={kind.id} value={kind.id}>
                  {kind.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Roof covering">
            <select
              data-testid="model-lab-roof-finish"
              value={form.roofFinish}
              onChange={(event) => set({ roofFinish: event.target.value })}
            >
              <option value="">As the preset</option>
              {finishOptions(definition.roof?.finishes ?? [])}
            </select>
          </Field>
          <Field label="Size (m) — width × depth × height">
            <div className="flex gap-1">
              {(['width', 'depth', 'height'] as const).map((axis) => (
                <input
                  key={axis}
                  aria-label={axis}
                  inputMode="decimal"
                  className="w-full"
                  value={form[axis]}
                  onChange={(event) => set({ [axis]: event.target.value })}
                />
              ))}
            </div>
          </Field>
        </div>
        <Field label="Notes (appended to the description; optional)">
          <input
            value={form.notes}
            maxLength={200}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </Field>
        {error ? <Note tone="warn">{error}</Note> : null}
        {spec ? (
          <details className="text-xs text-garden-muted">
            <summary className="cursor-pointer">The reference prompt for this spec</summary>
            <p className="mt-2 leading-relaxed">{composeReferencePrompt(spec)}</p>
            <p className="mt-2">Draw it with:</p>
            <code className="mt-1 block rounded bg-slate-50 p-2 break-all text-[11px]">
              {referenceCommand(form)}
            </code>
          </details>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-garden-forest">The picture to make it from</h2>
        {matching.length === 0 ? (
          <p className="text-xs text-garden-muted">
            No generated reference matches this spec yet. Draw one with the command under the prompt
            (it lands in <code>tools/assets/raw/references/</code>), or upload a product photograph.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {matching.map((candidate) => (
              <button
                key={candidate.name}
                type="button"
                data-testid={`model-lab-reference-${candidate.name}`}
                onClick={() => setReference({ kind: 'generated', name: candidate.name })}
                className={`overflow-hidden rounded-lg border ${
                  chosen?.kind === 'generated' && chosen.name === candidate.name
                    ? 'border-garden-forest ring-2 ring-garden-forest'
                    : 'border-garden-line'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a dev tool showing an API-served file */}
                <img
                  src={referenceImageUrl(candidate.name)}
                  alt=""
                  className="aspect-square w-full object-contain"
                />
              </button>
            ))}
          </div>
        )}
        <label className="flex flex-col gap-1 text-xs text-garden-muted">
          Or upload a PNG or JPEG (under 10 MB)
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(event) => upload(event.target.files?.[0])}
          />
        </label>
        {chosen?.kind === 'upload' ? (
          // eslint-disable-next-line @next/next/no-img-element -- the user's own upload, as a data URI
          <img
            src={chosen.dataUrl}
            alt={chosen.fileName}
            className="h-32 w-32 rounded-lg border border-garden-line object-contain"
          />
        ) : null}
        <label className="flex items-center gap-2 text-xs text-garden-muted">
          <input
            type="checkbox"
            checked={force}
            onChange={(event) => setForce(event.target.checked)}
          />
          Generate even if the library already has a model of this
        </label>
        <button
          type="button"
          data-testid="model-lab-generate"
          disabled={!status?.available || !chosen || !spec || busy}
          onClick={() => void submit()}
          className="rounded-full bg-garden-forest px-4 py-2 text-sm font-semibold text-white hover:bg-garden-green disabled:opacity-40"
        >
          {busy ? 'Asking…' : `Generate (about ${status?.estimatedCost ?? 30} credits)`}
        </button>
        {answer ? <Note tone={answer.tone}>{answer.text}</Note> : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ jobs */

const STATUS_TONE: Record<ModelJob['status'], string> = {
  requested: 'bg-slate-100 text-slate-700',
  submitting: 'bg-slate-100 text-slate-700',
  submitted: 'bg-sky-100 text-sky-800',
  generating: 'bg-sky-100 text-sky-800',
  downloading: 'bg-sky-100 text-sky-800',
  processing: 'bg-sky-100 text-sky-800',
  review: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-slate-100 text-slate-500',
  failed: 'bg-rose-100 text-rose-800',
  cancelled: 'bg-slate-100 text-slate-500',
};

function summary(spec: ModelAssetSpec): string {
  const facts = spec.structure;
  const label = (id: string) => STRUCTURE_FINISHES[id as StructureFinishId]?.label ?? id;
  const parts: string[] = [spec.symbol];
  if (facts) {
    parts.push(
      facts.model,
      `${label(facts.frame)} frame`,
      `${facts.roofKind} roof in ${label(facts.roofFinish)}`,
    );
    const screened = Object.entries(facts.sides).filter(([, infill]) => infill !== 'open');
    if (screened.length) parts.push(`screened ${screened.map(([side]) => side).join(', ')}`);
    if (facts.lighting) parts.push('lit');
  } else if (spec.material) {
    parts.push(spec.material);
  }
  parts.push(`${spec.nominal.width} × ${spec.nominal.depth} × ${spec.nominal.height} m`);
  return parts.join(' · ');
}

/** A library id from the spec: `gazebo-classic-dark-stained-timber-shingle-dark-3x3`. */
function suggestedId(spec: ModelAssetSpec): string {
  const facts = spec.structure;
  const words = [
    spec.symbol,
    facts?.model,
    facts?.frame,
    facts && facts.roofFinish !== facts.frame ? facts.roofFinish : null,
  ];
  return [...words, `${spec.nominal.width}x${spec.nominal.depth}`]
    .filter(Boolean)
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function JobCard({ job, onChanged }: { job: ModelJob; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const live = LIVE_MODEL_JOB_STATUSES.includes(job.status);
  const thumbs = job.files.filter((file) => /^thumb-(front|right|back|left)\.png$/.test(file));

  const act = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (failure) {
      setError((failure as Error).message);
    }
  };

  return (
    <article
      data-testid={`model-job-${job.id}`}
      data-status={job.status}
      className="flex flex-col gap-3 rounded-xl border border-garden-line bg-white p-4"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_TONE[job.status]}`}>
          {job.status}
        </span>
        <span className="font-medium text-garden-ink">{summary(job.spec)}</span>
        <span className="ml-auto text-garden-muted">
          {job.aiModel} · {job.credits} credits · {new Date(job.createdAt).toLocaleString()}
        </span>
      </div>
      {live ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-sky-500 transition-all" style={{ width: `${job.progress}%` }} />
        </div>
      ) : null}
      {job.error ? (
        <Note tone={job.status === 'failed' ? 'warn' : undefined}>{job.error}</Note>
      ) : null}
      {thumbs.length ? (
        <div className="flex gap-2">
          {thumbs.map((file) => (
            // eslint-disable-next-line @next/next/no-img-element -- Meshy's own renders, served by the API
            <img
              key={file}
              src={jobFileUrl(job.id, file)}
              alt={file}
              className="h-24 w-24 rounded-lg border border-garden-line bg-slate-50 object-contain"
            />
          ))}
        </div>
      ) : null}
      {job.status === 'review' ? <Review job={job} onChanged={onChanged} /> : null}
      {job.status === 'approved' ? (
        <Note tone="ok">
          Published as <code>{job.publishedAssetId}</code>. Review and commit{' '}
          <code>apps/web/public/models/</code>.
        </Note>
      ) : null}
      {job.status === 'requested' || job.status === 'submitted' ? (
        <div>
          <button
            type="button"
            data-testid={`model-job-cancel-${job.id}`}
            onClick={() => void act(() => cancelJob(job.id))}
            className="rounded-full border border-garden-line px-3 py-1 text-xs hover:bg-garden-sage"
          >
            Cancel{job.status === 'submitted' ? ' (refunded while Meshy has not started)' : ''}
          </button>
        </div>
      ) : null}
      {error ? <Note tone="warn">{error}</Note> : null}
    </article>
  );
}

function Review({ job, onChanged }: { job: ModelJob; onChanged: () => void }) {
  const result = job.result!;
  const [w, , d] = result.naturalSize;
  const [turn, setTurn] = useState<0 | 90 | 180 | 270>(result.frontYawDeg as 0 | 90 | 180 | 270);
  const [assetId, setAssetId] = useState(() => suggestedId(job.spec));
  const [turnable, setTurnable] = useState(() => Math.abs(w - d) / Math.max(w, d) < 0.05);
  // The height Meshy gave it, before any stretch, against the height the spec asked for.
  const asked = job.spec.nominal.height;
  const madeHeight = result.naturalSize[1] / result.heightStretch;
  const offBy = madeHeight / asked - 1;
  const [fitHeight, setFitHeight] = useState(result.heightStretch !== 1);
  const stretchY = (fitHeight ? asked / madeHeight : 1) / result.heightStretch;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <div className="h-80 overflow-hidden rounded-lg border border-garden-line">
        <ModelPreview
          url={`${jobFileUrl(job.id, 'processed.glb')}?v=${encodeURIComponent(job.updatedAt)}`}
          turnDeg={turn - result.frontYawDeg}
          size={result.naturalSize}
          stretchY={stretchY}
        />
      </div>
      <div className="flex flex-col gap-3 text-xs">
        <p className="text-garden-muted">
          {result.naturalSize.map((value) => value.toFixed(2)).join(' × ')} m ·{' '}
          {result.triangles.toLocaleString()} triangles · {(result.bytes / 1024 / 1024).toFixed(2)}{' '}
          MB · textures ≤ {result.maxTexturePx} px
        </p>
        {result.defects.map((defect) => (
          <Note key={defect} tone="warn">
            Defect: {defect}
          </Note>
        ))}
        {result.warnings.map((warning) => (
          <Note key={warning}>{warning}</Note>
        ))}
        <Field label="Turn until its front faces the orange arrow (+Z)">
          <div className="flex gap-1">
            {([0, 90, 180, 270] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTurn(value)}
                className={`rounded-full border px-3 py-1 ${turn === value ? 'border-garden-forest bg-garden-sage' : 'border-garden-line'}`}
              >
                {value}°
              </button>
            ))}
          </div>
        </Field>
        {Math.abs(offBy) > 0.15 || result.heightStretch !== 1 ? (
          <label className="flex items-start gap-2 text-garden-ink">
            <input
              type="checkbox"
              data-testid={`model-job-fit-height-${job.id}`}
              checked={fitHeight}
              onChange={(event) => setFitHeight(event.target.checked)}
            />
            <span>
              Stretch it upright to the {asked} m asked for (×{(asked / madeHeight).toFixed(2)}).
              Meshy made it {madeHeight.toFixed(2)} m, {Math.round(Math.abs(offBy) * 100)}%{' '}
              {offBy < 0 ? 'short' : 'tall'}; as made it could only draw gazebos{' '}
              {(madeHeight / 1.15).toFixed(2)}–{(madeHeight * 1.15).toFixed(2)} m tall. Fine for
              straight posts and slats; look hard at braces and pitched roofs.
            </span>
          </label>
        ) : null}
        <Field label="Library id (immutable once published)">
          <input
            data-testid={`model-job-asset-id-${job.id}`}
            value={assetId}
            onChange={(event) => setAssetId(event.target.value)}
          />
        </Field>
        <label className="flex items-center gap-2 text-garden-muted">
          <input
            type="checkbox"
            checked={turnable}
            onChange={(event) => setTurnable(event.target.checked)}
          />
          Square and symmetric enough to be turned a quarter to fit
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid={`model-job-publish-${job.id}`}
            disabled={busy || result.defects.length > 0}
            onClick={() =>
              void decide(() =>
                publishJob(job.id, { assetId, frontYawDeg: turn, turnable, fitHeight }),
              )
            }
            className="rounded-full bg-garden-forest px-4 py-1.5 font-semibold text-white hover:bg-garden-green disabled:opacity-40"
          >
            {busy ? 'Publishing…' : 'Publish to the library'}
          </button>
          <button
            type="button"
            data-testid={`model-job-reject-${job.id}`}
            disabled={busy}
            onClick={() => void decide(() => rejectJob(job.id))}
            className="rounded-full border border-garden-line px-4 py-1.5 hover:bg-garden-sage"
          >
            Reject
          </button>
        </div>
        {error ? <Note tone="warn">{error}</Note> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ small parts */

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-garden-muted [&_input]:rounded-md [&_input]:border [&_input]:border-garden-line [&_input]:px-2 [&_input]:py-1 [&_input]:text-garden-ink [&_select]:rounded-md [&_select]:border [&_select]:border-garden-line [&_select]:px-2 [&_select]:py-1 [&_select]:text-garden-ink">
      {label}
      {children}
    </label>
  );
}

function Note({
  children,
  tone,
  testId,
}: {
  children: ReactNode;
  tone?: 'ok' | 'warn';
  testId?: string;
}) {
  const colours =
    tone === 'ok'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-900'
        : 'border-garden-line bg-slate-50 text-garden-ink';
  return (
    <p
      data-testid={testId}
      className={`rounded-lg border px-3 py-2 text-xs leading-relaxed ${colours}`}
    >
      {children}
    </p>
  );
}
