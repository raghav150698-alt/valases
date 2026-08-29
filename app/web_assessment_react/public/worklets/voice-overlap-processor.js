class VoiceOverlapProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.size = 2048;
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;
    for (let index = 0; index < input.length; index += 1) {
      this.buffer.push(input[index]);
      output[index] = input[index];
    }
    while (this.buffer.length >= this.size) {
      const frame = this.buffer.splice(0, this.size);
      const rms = Math.sqrt(frame.reduce((sum, value) => sum + value * value, 0) / frame.length);
      const real = new Float64Array(this.size);
      const imag = new Float64Array(this.size);
      for (let index = 0; index < this.size; index += 1) real[index] = frame[index] * (0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (this.size - 1)));
      for (let index = 1, reversed = 0; index < this.size; index += 1) {
        let bit = this.size >> 1;
        for (; reversed & bit; bit >>= 1) reversed ^= bit;
        reversed ^= bit;
        if (index < reversed) { const swap = real[index]; real[index] = real[reversed]; real[reversed] = swap; }
      }
      for (let length = 2; length <= this.size; length <<= 1) {
        const angle = -2 * Math.PI / length;
        for (let offset = 0; offset < this.size; offset += length) {
          for (let index = 0; index < length / 2; index += 1) {
            const even = offset + index;
            const odd = even + length / 2;
            const phase = angle * index;
            const wr = Math.cos(phase); const wi = Math.sin(phase);
            const tr = wr * real[odd] - wi * imag[odd];
            const ti = wr * imag[odd] + wi * real[odd];
            real[odd] = real[even] - tr; imag[odd] = imag[even] - ti;
            real[even] += tr; imag[even] += ti;
          }
        }
      }
      const bandEdges = [[250, 700], [700, 1400], [1400, 2400], [2400, 3800]];
      const binHz = sampleRate / this.size;
      const bands = bandEdges.map(([low, high]) => {
        let total = 0; let count = 0;
        for (let bin = Math.max(1, Math.floor(low / binHz)); bin < Math.min(this.size / 2, Math.ceil(high / binHz)); bin += 1) {
          total += Math.hypot(real[bin], imag[bin]); count += 1;
        }
        return total / Math.max(1, count);
      });
      const speechStart = Math.max(1, Math.floor(250 / binHz));
      const speechEnd = Math.min(this.size / 2, Math.ceil(3800 / binHz));
      let total = 0; let weighted = 0; let geometric = 0; let count = 0; let peaks = 0;
      let previous = 0; let current = 0;
      for (let bin = speechStart; bin < speechEnd; bin += 1) {
        const magnitude = Math.hypot(real[bin], imag[bin]) + 1e-8;
        total += magnitude; weighted += bin * binHz * magnitude; geometric += Math.log(magnitude); count += 1;
        if (bin > speechStart && current > previous && current > magnitude) peaks += 1;
        previous = current; current = magnitude;
      }
      const normalizedBands = bands.map((value) => value / Math.max(1e-8, bands.reduce((sum, item) => sum + item, 0)));
      this.port.postMessage({ features: [rms, weighted / Math.max(1, total) / 3800, Math.exp(geometric / Math.max(1, count)) / Math.max(1e-8, total / Math.max(1, count)), peaks / Math.max(1, count), ...normalizedBands] });
    }
    return true;
  }
}

registerProcessor("voice-overlap-processor", VoiceOverlapProcessor);
