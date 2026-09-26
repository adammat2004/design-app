import { useLocalSearchParams } from 'expo-router';
import { Alert, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { summarise } from '../../scene/summarise';
import { useARScene } from '../../scene/use-ar-scene';

/**
 * What a scene contains, and the door into AR.
 *
 * The AR view does not exist yet — building it is the first milestone in
 * docs/ar/ar-architecture.md. It needs ViroReact, which is native code, so it also needs a
 * development build; this screen runs in Expo Go until then.
 */
export default function SceneScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useARScene(id);

  if (state.status === 'loading') return <Text style={styles.body}>Loading…</Text>;
  if (state.status === 'error') return <Text style={styles.body}>{state.message}</Text>;

  const { scene } = state;
  const facts = summarise(scene);
  const categories = Object.entries(facts.categories)
    .map(([category, count]) => `${category} ${count}`)
    .join(', ');

  return (
    <ScrollView contentContainerStyle={styles.body}>
      <Text style={styles.title}>{scene.source.projectName}</Text>
      <Text style={styles.line}>
        {facts.footprint.width.toFixed(1)} × {facts.footprint.depth.toFixed(1)} m, origin at the{' '}
        {scene.frame.origin.kind.replace('-', ' ')}
      </Text>
      <Text style={styles.heading}>Contents</Text>
      <Text style={styles.line}>
        {facts.nodes.surface} surfaces, {facts.nodes.solid} solids, {facts.nodes.model} models,{' '}
        {facts.plantInstances} plants in {facts.nodes.plants} group(s)
      </Text>
      <Text style={styles.line}>{categories}</Text>
      <Text style={styles.line}>
        {facts.triangles} triangles of built geometry; {facts.hiddenByDefault} thing(s) hidden by
        default because they already exist in the real garden
      </Text>
      <Text style={styles.heading}>Alignment points</Text>
      {scene.referencePoints.map((point) => (
        <Text key={point.id} style={styles.line}>
          • {point.label} ({point.at[0].toFixed(1)}, {point.at[1].toFixed(1)})
        </Text>
      ))}
      <Pressable
        style={styles.button}
        testID="open-ar"
        onPress={() =>
          Alert.alert(
            'AR is not built yet',
            'The AR view is the first milestone. See docs/ar/ar-architecture.md.',
          )
        }
      >
        <Text style={styles.buttonText}>View in AR</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  heading: { fontSize: 15, fontWeight: '600', marginTop: 20, marginBottom: 6 },
  line: { color: '#333', lineHeight: 21 },
  button: {
    marginTop: 28,
    backgroundColor: '#2f5d3a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
