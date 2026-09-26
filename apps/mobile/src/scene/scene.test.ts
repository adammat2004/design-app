import { readARScene } from '@garden-studio/ar-contract';
import { sampleGarden } from '../fixtures/sample-garden';
import { fixtureSource } from './fixture-source';
import { summarise } from './summarise';

describe('the sample garden', () => {
  it('is a valid scene this app can read', () => {
    expect(() => readARScene(sampleGarden)).not.toThrow();
  });

  it('has a pergola 3 m square and 2.4 m tall — the scale check for the first AR milestone', () => {
    const pergola = sampleGarden.nodes.find((node) => node.id === 'pergola');
    if (pergola?.kind !== 'solid') throw new Error('the sample garden has no pergola');
    const positions = pergola.parts[0]!.mesh.positions;
    const axis = (offset: number) => positions.filter((_, index) => index % 3 === offset);
    const span = (values: number[]) => Math.max(...values) - Math.min(...values);
    expect(span(axis(1))).toBeCloseTo(2.4, 6);
    // Posts are 3 m apart outside to outside; the beams overhang them by 0.15 m each end.
    expect(span(axis(0))).toBeCloseTo(3.3, 6);
  });

  it('can be listed and loaded through the scene source', async () => {
    const source = fixtureSource();
    expect(await source.list()).toEqual([{ id: 'sample-garden', name: 'Sample garden' }]);
    const facts = summarise(await source.load('sample-garden'));
    expect(facts.nodes).toEqual({ surface: 5, solid: 3, model: 5, plants: 1 });
    expect(facts.footprint).toEqual({ width: 10, depth: 20 });
  });

  it('refuses a scene id that does not exist', async () => {
    await expect(fixtureSource().load('nope')).rejects.toThrow(/No bundled scene/);
  });
});
