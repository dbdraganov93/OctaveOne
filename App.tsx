import React, {useEffect, useRef, useState} from 'react';
import {
  PermissionsAndroid,
  Platform,
  StyleSheet,
  View,
  Text,
  Dimensions,
} from 'react-native';
import AudioRecord from 'react-native-audio-record';
import {Buffer} from 'buffer';
import FFT from 'fft.js';
import Svg, {Polyline} from 'react-native-svg';

const SAMPLE_RATE = 44100;
const FFT_SIZE = 1024;

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

function App() {
  const [frequency, setFrequency] = useState(0);
  const [wave, setWave] = useState<number[]>(new Array(FFT_SIZE).fill(0));
  const bufferRef = useRef<Float32Array>(new Float32Array(0));
  const fftRef = useRef(new FFT(FFT_SIZE));

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
      <Text style={styles.freqText}>{frequency.toFixed(1)} Hz</Text>
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
  freqText: {
    color: '#fff',
    fontSize: 32,
    marginBottom: 20,
  },
});

export default App;
