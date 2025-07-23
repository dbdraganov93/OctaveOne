import React, {useEffect, useRef, useState, useMemo} from 'react';
import {
  PermissionsAndroid,
  Platform,
  StyleSheet,
  View,
  Text,
  Dimensions,
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

const SAMPLE_RATE = 44100;
const FFT_SIZE = 1024;
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function frequencyToNoteInfo(freq: number) {
  if (freq <= 0) {
    return {note: '--', cents: 0};
  }
  const n = Math.round(12 * Math.log2(freq / 440) + 69);
  const clamped = Math.min(108, Math.max(21, n));
  const name = `${NOTE_NAMES[clamped % 12]}${Math.floor(clamped / 12 - 1)}`;
  const ideal = 440 * Math.pow(2, (clamped - 69) / 12);
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

function PianoKeyboard({currentNote}: {currentNote: string}) {
  const base = currentNote.replace(/\d+/g, '');
  return (
    <View style={styles.keyboardContainer}>
      {NOTE_NAMES.map(name => (
        <PianoKey key={name} name={name} active={name === base} />
      ))}
    </View>
  );
}

function PianoKey({name, active}: {name: string; active: boolean}) {
  const opacity = useSharedValue(active ? 1 : 0);
  useEffect(() => {
    opacity.value = withTiming(active ? 1 : 0, {duration: 80});
  }, [active, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const isSharp = name.includes('#');
  return (
    <View
      style={[
        styles.key,
        isSharp ? styles.blackKey : styles.whiteKey,
      ]}>
      <Animated.View style={[styles.keyHighlight, animatedStyle]} />
    </View>
  );
}

function App() {
  const [frequency, setFrequency] = useState(0);
  const [wave, setWave] = useState<number[]>(new Array(FFT_SIZE).fill(0));
  const bufferRef = useRef<Float32Array>(new Float32Array(0));
  const fftRef = useRef(new FFT(FFT_SIZE));
  const noteInfo = useMemo(() => frequencyToNoteInfo(frequency), [frequency]);

  useEffect(() => {
    async function init() {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        );
      }
      AudioRecord.init({
        sampleRate: SAMPLE_RATE,
        channels: 1,
        bitsPerSample: 16,
        wavFile: 'tmp.wav',
      });

      AudioRecord.on('data', data => {
        const chunk = Buffer.from(data, 'base64');
        const samples = new Int16Array(
          chunk.buffer,
          chunk.byteOffset,
          chunk.length / 2,
        );
        const floats = new Float32Array(samples.length);
        for (let i = 0; i < samples.length; i++) {
          floats[i] = samples[i] / 32768;
        }
        setWave(prev => {
          const merged = Float32Array.from([
            ...prev.slice(-FFT_SIZE / 2),
            ...Array.from(floats.slice(0, FFT_SIZE / 2)),
          ]);
          return Array.from(merged);
        });
        const current = new Float32Array(
          bufferRef.current.length + floats.length,
        );
        current.set(bufferRef.current);
        current.set(floats, bufferRef.current.length);
        bufferRef.current = current.slice(-FFT_SIZE);
        if (bufferRef.current.length >= FFT_SIZE) {
          const out = fftRef.current.createComplexArray();
          fftRef.current.realTransform(out, bufferRef.current);
          fftRef.current.completeSpectrum(out);
          let maxMag = 0;
          let maxIndex = 0;
          for (let i = 1; i < FFT_SIZE / 2; i++) {
            const re = out[2 * i];
            const im = out[2 * i + 1];
            const mag = Math.sqrt(re * re + im * im);
            if (mag > maxMag) {
              maxMag = mag;
              maxIndex = i;
            }
          }
          setFrequency((maxIndex * SAMPLE_RATE) / FFT_SIZE);
        }
      });

      AudioRecord.start();
    }

    init();
    return () => {
      AudioRecord.stop();
    };
  }, []);

  return (
    <LinearGradient colors={['#0c0c0c', '#202020']} style={styles.container}>
      <Text style={styles.noteText}>{noteInfo.note}</Text>
      <Text style={styles.freqText}>{frequency.toFixed(1)} Hz</Text>
      <Text style={styles.centsText}>
        {noteInfo.cents < 0 ? '←' : noteInfo.cents > 0 ? '→' : '•'}{' '}
        {Math.abs(noteInfo.cents).toFixed(1)} cents
      </Text>
      <TuningMeter cents={noteInfo.cents} />
      <Waveform data={wave} />
      <PianoKeyboard currentNote={noteInfo.note} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 60,
    alignItems: 'center',
  },
  noteText: {
    color: '#fff',
    fontSize: 42,
    marginBottom: 10,
  },
  freqText: {
    color: '#fff',
    fontSize: 32,
    marginBottom: 20,
  },
  centsText: {
    color: '#fff',
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
