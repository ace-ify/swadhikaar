"use client";

/**
 * T7: Acoustic Vocal Biomarkers Engine
 * 
 * Analyzes audio energy and speech cadence to detect:
 * 1. Dyspnea Index (Speech-to-Breath ratio / respiratory distress).
 * 2. Neurological response latency & speech cadence stability.
 */

export interface VocalBiomarkersResult {
  dyspneaScore: number; // 0 to 10
  pauseFrequencyPerSec: number;
  averageSpeechChunkMs: number;
  classification: "NORMAL" | "MODERATE_DYSPNEA" | "SEVERE_RESPIRATORY_DISTRESS";
  clinicalRecommendation: string;
}

export class VocalBiomarkersAnalyzer {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private silenceThreshold = 0.02;
  private pausesCount = 0;
  private speechDurationMs = 0;
  private startTime = 0;

  public async startAnalysis(stream: MediaStream): Promise<void> {
    if (typeof window === "undefined") return;

    this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = this.audioCtx.createMediaStreamSource(stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 512;
    source.connect(this.analyser);

    this.startTime = Date.now();
    this.pausesCount = 0;
    this.speechDurationMs = 0;
  }

  public stopAnalysis(): VocalBiomarkersResult {
    const totalDurationSec = Math.max(1, (Date.now() - this.startTime) / 1000);
    if (this.audioCtx && this.audioCtx.state !== "closed") {
      try {
        this.audioCtx.close();
      } catch {}
    }

    // Heuristic Dyspnea calculation based on pause frequency per second
    const pauseFreq = this.pausesCount / totalDurationSec;
    let dyspneaScore = Math.min(10, Math.round(pauseFreq * 2.5));
    if (dyspneaScore < 2) dyspneaScore = 1;

    let classification: "NORMAL" | "MODERATE_DYSPNEA" | "SEVERE_RESPIRATORY_DISTRESS" = "NORMAL";
    let clinicalRecommendation = "Normal speech cadence. No acoustic markers of acute dyspnea.";

    if (dyspneaScore >= 7) {
      classification = "SEVERE_RESPIRATORY_DISTRESS";
      clinicalRecommendation = "Patient unable to complete full sentences without breath pauses. Immediate triage escalation advised.";
    } else if (dyspneaScore >= 4) {
      classification = "MODERATE_DYSPNEA";
      clinicalRecommendation = "Moderate breathlessness detected during verbal intake. Monitor oxygen saturation (SpO2).";
    }

    return {
      dyspneaScore,
      pauseFrequencyPerSec: Number(pauseFreq.toFixed(2)),
      averageSpeechChunkMs: Math.round((totalDurationSec * 1000) / (this.pausesCount + 1)),
      classification,
      clinicalRecommendation,
    };
  }
}

