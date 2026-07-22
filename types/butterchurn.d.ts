declare module 'butterchurn' {
  interface VisualizerConfig {
    width: number
    height: number
    pixelRatio?: number
    textureRatio?: number
  }

  interface Visualizer {
    connectAudio(audioNode: AudioNode): void
    disconnectAudio(): void
    loadPreset(preset: any, duration: number): void
    setRendererSize(width: number, height: number): void
    render(): void
    destroy(): void
  }

  function createVisualizer(
    audioContext: AudioContext,
    canvas: HTMLCanvasElement,
    config: VisualizerConfig
  ): Visualizer

  export { createVisualizer }
  export default { createVisualizer }
}

declare module 'butterchurn-presets' {
  export interface Preset {
  }

  function getPresets(): Record<string, Preset>

  export { getPresets }
  export default { getPresets }
}
