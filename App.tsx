import React, {useEffect, useRef, useState, useMemo} from 'react';
import {
  PermissionsAndroid,
  Platform,
  StyleSheet,
  View,
  Text,
  Dimensions,
  TouchableOpacity,
  Alert,
} from 'react-native';
import Animated, {
  useSharedValue,
  withTiming,
  useAnimatedStyle,
} from 'react-native-reanimated';
import AudioRecord from 'react-native-audio-record';
import {Buffer} from 'buffer';
import FFT from 'fft.js';
import Svg, {Polyline} from 'react-native-svg';
import LinearGradient from 'react-native-linear-gradient';
import SettingsModal, {loadSettings, saveSettings, Settings} from './SettingsModal';

const SAMPLE_RATE = 44100;
// Larger FFT improves frequency resolution but still keeps latency below 50ms
const FFT_SIZE = 2048;
const HP_CUTOFF = 20; // Hz
const LP_CUTOFF = 5000; // Hz
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

type FilterState = {prevInput: number; prevOutput: number};

function highPass(sample: number, state: FilterState, cutoff: number) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / SAMPLE_RATE;
  const alpha = rc / (rc + dt);
  const out = alpha * (state.prevOutput + sample - state.prevInput);
  state.prevInput = sample;
  state.prevOutput = out;
  return out;
}

function lowPass(sample: number, state: FilterState, cutoff: number) {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / SAMPLE_RATE;
  const alpha = dt / (rc + dt);
  state.prevOutput = state.prevOutput + alpha * (sample - state.prevOutput);
  return state.prevOutput;
}

function frequencyToNoteInfo(freq: number, ref: number) {
  if (freq <= 0) {
    return {note: '--', cents: 0};
  }
  const n = Math.round(12 * Math.log2(freq / ref) + 69);
  const clamped = Math.min(108, Math.max(21, n));
  const name = `${NOTE_NAMES[clamped % 12]}${Math.floor(clamped / 12 - 1)}`;
  const ideal = ref * Math.pow(2, (clamped - 69) / 12);
  const cents = 1200 * Math.log2(freq / ideal);
  return {note: name, cents};
}

function manualNoteInfo(freq: number, targetIndex: number, ref: number) {
  if (freq <= 0) {
    return {note: `${NOTE_NAMES[targetIndex]}-`, cents: 0};
  }
  const approx = 12 * Math.log2(freq / ref) + 69;
  const baseOct = Math.round(approx / 12);
  const candidates = [
    baseOct * 12 + targetIndex,
    (baseOct - 1) * 12 + targetIndex,
    (baseOct + 1) * 12 + targetIndex,
  ];
  let best = candidates[0];
  let bestDiff = Infinity;
  for (const c of candidates) {
    if (c < 21 || c > 108) continue;
    const ideal = ref * Math.pow(2, (c - 69) / 12);
    const diff = Math.abs(Math.log2(freq / ideal));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = c;
    }
  }
  const name = `${NOTE_NAMES[targetIndex]}${Math.floor(best / 12 - 1)}`;
  const ideal = ref * Math.pow(2, (best - 69) / 12);
  const cents = 1200 * Math.log2(freq / ideal);
  return {note: name, cents};
}

function Waveform({data}: {data: number[]}) {
  const width = Dimensions.get('window').width;
  const height = 120;
  const step = width / data.length;
  const points = data
    .map((v, i) => `${i * step},${(1 - v) * height * 0.5}`)
    .join(' ');

  return (
    <Svg width={width} height={height}>
      <Polyline points={points} stroke="cyan" strokeWidth="2" fill="none" />
    </Svg>
  );
}

const GAUGE_SIZE = 220;

function TuningMeter({cents}: {cents: number}) {
  const value = useSharedValue(0);

  useEffect(() => {
    value.value = withTiming(cents, {duration: 80});
  }, [cents, value]);

  const animatedStyle = useAnimatedStyle(() => {
    const clamped = Math.max(-50, Math.min(50, value.value));
    const rotate = (clamped / 50) * 90; // -90 to 90
    return {
      transform: [{rotate: `${rotate}deg`}],
    };
  });

  return (
    <View style={styles.gaugeContainer}>
      <View style={styles.gaugeArc} />
      <Animated.View style={[styles.gaugeNeedle, animatedStyle]} />
    </View>
  );
}

function PianoKeyboard({
  highlight,
  onSelect,
}: {
  highlight: string;
  onSelect?: (name: string) => void;
}) {
  return (
    <View style={styles.keyboardContainer}>
      {NOTE_NAMES.map(name => (
        <PianoKey
          key={name}
          name={name}
          active={name === highlight}
          onPress={() => onSelect?.(name)}
        />
      ))}
    </View>
  );
}

function PianoKey({
  name,
  active,
  onPress,
}: {
  name: string;
  active: boolean;
  onPress?: () => void;
}) {
  const opacity = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(active ? 1 : 0, {duration: 80});
  }, [active, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const isSharp = name.includes('#');
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.key, isSharp ? styles.blackKey : styles.whiteKey]}
    >
      <Animated.View style={[styles.keyHighlight, animatedStyle]} />
    </TouchableOpacity>
  );
}

function App() {
  const [frequency, setFrequency] = useState(0);
  const [wave, setWave] = useState<number[]>(new Array(FFT_SIZE).fill(0));
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [targetIndex, setTargetIndex] = useState(9); // default to A
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const bufferRef = useRef<Float32Array>(new Float32Array(0));
  const fftRef = useRef(new FFT(FFT_SIZE));
  const hpState = useRef<FilterState>({prevInput: 0, prevOutput: 0});
  const lpState = useRef<FilterState>({prevInput: 0, prevOutput: 0});
  const smoothRef = useRef(0);
  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);
  const noteInfo = useMemo(
    () =>
      mode === 'auto'
        ? frequencyToNoteInfo(frequency, settings?.referencePitch ?? 440)
        : manualNoteInfo(frequency, targetIndex, settings?.referencePitch ?? 440),
    [frequency, mode, targetIndex, settings?.referencePitch],
  );

  useEffect(() => {
    async function init() {
      async function requestMicrophone() {
        if (Platform.OS === 'android') {
          const result = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          );
          return result === PermissionsAndroid.RESULTS.GRANTED;
        }
        return true;
      }

      if (!(await requestMicrophone())) {
        Alert.alert('Microphone permission required');
        return;
      }
      AudioRecord.init({
        sampleRate: SAMPLE_RATE,
        channels: 1,
        bitsPerSample: 16,
        wavFile: 'tmp.wav',
      });

      const temp = {samples: new Int16Array(0), filtered: new Float32Array(0)};

      AudioRecord.on('data', data => {
        const chunk = Buffer.from(data, 'base64');
        if (temp.samples.length !== chunk.length / 2) {
          temp.samples = new Int16Array(chunk.length / 2);
          temp.filtered = new Float32Array(chunk.length / 2);
        }
        temp.samples.set(
          new Int16Array(chunk.buffer, chunk.byteOffset, chunk.length / 2),
        );
        const {samples, filtered} = temp;
        for (let i = 0; i < samples.length; i++) {
          let s = samples[i] / 32768;
          if (settings?.noiseFilter !== false) {
            s = highPass(s, hpState.current, HP_CUTOFF);
            s = lowPass(s, lpState.current, LP_CUTOFF);
          }
          filtered[i] = s;
        }
        setWave(prev => {
          const merged = Float32Array.from([
            ...prev.slice(-FFT_SIZE / 2),
            ...Array.from(filtered.slice(0, FFT_SIZE / 2)),
          ]);
          return Array.from(merged);
        });
        const current = new Float32Array(
          bufferRef.current.length + filtered.length,
        );
        current.set(bufferRef.current);
        current.set(filtered, bufferRef.current.length);
        bufferRef.current = current.slice(-FFT_SIZE);
        if (bufferRef.current.length >= FFT_SIZE) {
          const out = fftRef.current.createComplexArray();
          fftRef.current.realTransform(out, bufferRef.current);
          fftRef.current.completeSpectrum(out);

          const mags = new Float32Array(FFT_SIZE / 2);
          for (let i = 1; i < FFT_SIZE / 2; i++) {
            const re = out[2 * i];
            const im = out[2 * i + 1];
            mags[i] = Math.sqrt(re * re + im * im);
          }

          let best = 0;
          let bestIndex = 0;
          const limit = Math.min(mags.length, Math.floor((LP_CUTOFF * FFT_SIZE) / SAMPLE_RATE));
          for (let i = 1; i < limit; i++) {
            const fundamental = mags[i];
            const second = i * 2 < mags.length ? mags[i * 2] * 0.5 : 0;
            const third = i * 3 < mags.length ? mags[i * 3] * 0.33 : 0;
            const score = fundamental + second + third;
            if (score > best) {
              best = score;
              bestIndex = i;
            }
          }

          let index = bestIndex;
          if (index > 0 && index < mags.length - 1) {
            const a = mags[index - 1];
            const b = mags[index];
            const c = mags[index + 1];
            const p = 0.5 * (a - c) / (a - 2 * b + c);
            index = index + p;
          }

          const detected = (index * SAMPLE_RATE) / FFT_SIZE;
          smoothRef.current = smoothRef.current * 0.8 + detected * 0.2;
          setFrequency(smoothRef.current);
        }
      });

      AudioRecord.start();
    }

    init();
    return () => {
      AudioRecord.stop();
    };
  }, []);

  if (!settings) {
    return null;
  }

  const gradientColors = settings.darkTheme
    ? ['#0c0c0c', '#202020']
    : ['#fafafa', '#e0e0e0'];
  const textColor = settings.darkTheme ? '#fff' : '#000';

  return (
    <LinearGradient
      colors={gradientColors}
      style={styles.container}>
      <TouchableOpacity
        style={styles.settingsToggle}
        onPress={() => setSettingsVisible(true)}>
        <Text style={[styles.modeText, {color: textColor}]}>⚙</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.modeToggle}
        onPress={() =>
          setMode(current => (current === 'auto' ? 'manual' : 'auto'))
        }>
        <Text style={[styles.modeText, {color: textColor}]}>
          {mode === 'auto' ? 'Auto' : 'Manual'}
        </Text>
      </TouchableOpacity>
      <Text style={[styles.noteText, {color: textColor}]}>{noteInfo.note}</Text>
      <Text style={[styles.freqText, {color: textColor}]}>{frequency.toFixed(1)} Hz</Text>
      <Text style={[styles.centsText, {color: textColor}]}>
        {noteInfo.cents < 0 ? '←' : noteInfo.cents > 0 ? '→' : '•'}{' '}
        {Math.abs(noteInfo.cents).toFixed(1)} cents
      </Text>
      <TuningMeter cents={noteInfo.cents} />
      <Waveform data={wave} />
      <PianoKeyboard
        highlight={
          mode === 'auto'
            ? noteInfo.note.replace(/\d+/g, '')
            : NOTE_NAMES[targetIndex]
        }
        onSelect={
          mode === 'manual'
            ? name => setTargetIndex(NOTE_NAMES.indexOf(name))
            : undefined
        }
      />
      <SettingsModal
        visible={settingsVisible}
        initial={settings}
        onClose={s => {
          setSettings(s);
          saveSettings(s);
          setSettingsVisible(false);
        }}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    alignItems: 'center',
  },
  settingsToggle: {
    position: 'absolute',
    top: 20,
    right: 20,
    padding: 6,
  },
  modeToggle: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    backgroundColor: '#444',
    marginBottom: 20,
  },
  modeText: {
    fontSize: 16,
  },
  noteText: {
    fontSize: 42,
    marginBottom: 10,
  },
  freqText: {
    fontSize: 32,
    marginBottom: 20,
  },
  centsText: {
    fontSize: 20,
    marginBottom: 10,
  },
  gaugeContainer: {
    width: GAUGE_SIZE,
    height: GAUGE_SIZE / 2,
    marginBottom: 20,
    justifyContent: 'flex-end',
    alignItems: 'center',
    overflow: 'hidden',
  },
  gaugeArc: {
    position: 'absolute',
    width: GAUGE_SIZE,
    height: GAUGE_SIZE,
    borderTopLeftRadius: GAUGE_SIZE / 2,
    borderTopRightRadius: GAUGE_SIZE / 2,
    borderWidth: 2,
    borderColor: '#555',
    borderBottomWidth: 0,
  },
  gaugeNeedle: {
    width: 2,
    height: GAUGE_SIZE / 2 - 10,
    backgroundColor: 'red',
    position: 'absolute',
    bottom: 0,
  },
  keyboardContainer: {
    flexDirection: 'row',
    width: '100%',
    height: 80,
    marginTop: 20,
  },
  key: {
    flex: 1,
    marginHorizontal: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  whiteKey: {
    backgroundColor: '#eee',
  },
  blackKey: {
    backgroundColor: '#333',
  },
  keyHighlight: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'orange',
    borderRadius: 4,
  },
});

export default App;
