"use client";

/**
 * Cross-Door Reactive Event Bus (BroadcastChannel)
 * Connects all Four Doors (/patient, /asha, /doctor, /dispatch) in real-time.
 * Ensures actions in Door 1 visibly react in Door 3 and Door 4 across browser tabs without page reloads.
 */

export type ClinicalBusEvent =
  | {
      type: "PATIENT_INTAKE_COMPLETED";
      payload: {
        patientId: string;
        name: string;
        age?: string;
        gender?: string;
        chiefComplaint: string;
        triageColor: "red" | "orange" | "yellow" | "green";
        timestamp: number;
      };
    }
  | {
      type: "EMERGENCY_SOS_TRIGGERED";
      payload: {
        incidentId: string;
        type: string;
        victimName?: string;
        coords: { lat: number; lng: number };
        triage: "red" | "orange" | "yellow";
        sbar: {
          situation: string;
          background: string;
          assessment: string;
          recommendation: string;
        };
        timestamp: number;
      };
    }
  | {
      type: "BEDSIDE_TRANSLATION_UTTERANCE";
      payload: {
        speaker: "doctor" | "patient";
        sourceText: string;
        sourceLang: string;
        translatedText: string;
        targetLang: string;
        timestamp: number;
      };
    }
  | {
      type: "LASA_WARNING_DETECTED";
      payload: {
        prescribedName: string;
        confusedWith: string;
        similarityScore: number;
        riskLevel: "CRITICAL" | "MODERATE";
      };
    };

const CHANNEL_NAME = "swadhikaar_clinical_event_bus";

class CrossDoorEventBus {
  private channel: BroadcastChannel | null = null;
  private listeners: Set<(event: ClinicalBusEvent) => void> = new Set();

  constructor() {
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (messageEvent) => {
          const busEvent = messageEvent.data as ClinicalBusEvent;
          this.listeners.forEach((listener) => listener(busEvent));
        };
      } catch (err) {
        console.warn("BroadcastChannel initialization skipped:", err);
      }
    }
  }

  public publish(event: ClinicalBusEvent) {
    // 1. Notify listeners on current tab
    this.listeners.forEach((listener) => listener(event));

    // 2. Broadcast across tabs/windows
    if (this.channel) {
      try {
        this.channel.postMessage(event);
      } catch (err) {
        console.warn("Failed to publish event across doors:", err);
      }
    }
  }

  public subscribe(listener: (event: ClinicalBusEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const clinicalEventBus = new CrossDoorEventBus();

