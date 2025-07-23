import React, {useState, useEffect} from 'react';
import {Modal, View, Text, StyleSheet, Switch, Button} from 'react-native';
import Slider from '@react-native-community/slider';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Settings = {
  referencePitch: number;
  noiseFilter: boolean;
  darkTheme: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  referencePitch: 440,
  noiseFilter: true,
  darkTheme: true,
};

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem('settings');
    if (raw) {
      return {...DEFAULT_SETTINGS, ...JSON.parse(raw)};
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings) {
  await AsyncStorage.setItem('settings', JSON.stringify(settings));
}

type Props = {
  visible: boolean;
  onClose: (settings: Settings) => void;
  initial: Settings;
};

export default function SettingsModal({visible, onClose, initial}: Props) {
  const [referencePitch, setReferencePitch] = useState(initial.referencePitch);
  const [noiseFilter, setNoiseFilter] = useState(initial.noiseFilter);
  const [darkTheme, setDarkTheme] = useState(initial.darkTheme);

  useEffect(() => {
    setReferencePitch(initial.referencePitch);
    setNoiseFilter(initial.noiseFilter);
    setDarkTheme(initial.darkTheme);
  }, [initial]);

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>Settings</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Reference Pitch: {referencePitch} Hz</Text>
          </View>
          <Slider
            minimumValue={415}
            maximumValue={466}
            step={1}
            value={referencePitch}
            onValueChange={setReferencePitch}
          />
          <View style={styles.row}>
            <Text style={styles.label}>Noise Filtering</Text>
            <Switch value={noiseFilter} onValueChange={setNoiseFilter} />
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Dark Theme</Text>
            <Switch value={darkTheme} onValueChange={setDarkTheme} />
          </View>
          <Button
            title="Done"
            onPress={() =>
              onClose({referencePitch, noiseFilter, darkTheme})
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  container: {
    width: '80%',
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 8,
  },
  title: {fontSize: 20, marginBottom: 10, fontWeight: 'bold'},
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 10,
  },
  label: {fontSize: 16},
});
