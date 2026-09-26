import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { sceneSource } from '../scene/fixture-source';
import type { SceneSummary } from '../scene/source';

/** Pick a garden to view. Lists whatever the scene source offers — bundled fixtures for now. */
export default function ScenePicker() {
  const [scenes, setScenes] = useState<SceneSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sceneSource.list().then(setScenes, (reason: unknown) => setError(String(reason)));
  }, []);

  if (error) return <Text style={styles.message}>Could not list gardens: {error}</Text>;
  if (!scenes) return <Text style={styles.message}>Loading…</Text>;

  return (
    <FlatList
      contentContainerStyle={styles.list}
      data={scenes}
      keyExtractor={(scene) => scene.id}
      ListHeaderComponent={
        <Text style={styles.intro}>
          Choose a garden to view at full size. These are bundled test scenes; real designs from the
          web app come later.
        </Text>
      }
      renderItem={({ item }) => (
        <Link href={{ pathname: '/scene/[id]', params: { id: item.id } }} asChild>
          <Pressable style={styles.row} testID={`scene-${item.id}`}>
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.id}>{item.id}</Text>
          </Pressable>
        </Link>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16 },
  intro: { color: '#555', marginBottom: 16, lineHeight: 20 },
  row: { paddingVertical: 14 },
  name: { fontSize: 17, fontWeight: '600' },
  id: { color: '#888', marginTop: 2 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#ccc' },
  message: { padding: 16 },
});
