import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="dark" />
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Garden Studio AR' }} />
        <Stack.Screen name="scene/[id]" options={{ title: 'Garden' }} />
      </Stack>
    </>
  );
}
