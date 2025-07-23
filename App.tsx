import React, {useEffect, useRef, useState, useMemo} from 'react';
import {
  PermissionsAndroid,
  Platform,
  StyleSheet,
  View,
  Text,
  Dimensions,
  Animated,
} from 'react-native';
import AudioRecord from 'react-native-audio-record';
import {Buffer} from 'buffer';
import FFT from 'fft.js';
import Svg, {Polyline} from 'react-native-svg';

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

const METER_WIDTH = 200;

function TuningMeter({cents}: {cents: number}) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: cents,
      duration: 100,
      useNativeDriver: true,
    }).start();
  }, [cents, anim]);

  const translateX = anim.interpolate({
    inputRange: [-50, 0, 50],
    outputRange: [-METER_WIDTH / 2, 0, METER_WIDTH / 2],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.meterContainer}>
      <View style={styles.meterBar} />
      <Animated.View style={[styles.needle, {transform: [{translateX}]}]} />
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
    <View style={styles.container}>
      <Text style={styles.noteText}>{noteInfo.note}</Text>
      <Text style={styles.freqText}>{frequency.toFixed(1)} Hz</Text>
      <Text style={styles.centsText}>
        {noteInfo.cents < 0 ? '←' : noteInfo.cents > 0 ? '→' : '•'}{' '}
        {Math.abs(noteInfo.cents).toFixed(1)} cents
      </Text>
      <TuningMeter cents={noteInfo.cents} />
      <Waveform data={wave} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
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
  meterContainer: {
    width: METER_WIDTH,
    height: 40,
    marginBottom: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  meterBar: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: '#555',
  },
  needle: {
    width: 2,
    height: 30,
    backgroundColor: 'red',
  },
});

export default App;
