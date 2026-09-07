"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Tooltip,
  Marker,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  calculateBearing,
  generateCurvedRoute,
  haversineDistanceM,
  interpolateAlongPolyline,
  polylineLengthM,
  type Point,
} from "@/lib/ambulance-routing";
import {
  Volume2,
  VolumeX,
  Play,
  Pause,
  Maximize2,
  Minimize2,
  Crosshair,
  Gauge,
  Navigation,
  Clock,
  MapPin,
  ShieldAlert,
} from "lucide-react";

export type AmbulanceStatus =
  | "dispatched"
  | "en_route"
  | "on_scene"
  | "transporting"
  | "arrived"
  | "resolved";

export interface LiveAmbulanceMapProps {
  scene: {
    lat: number;
    lon: number;
    label?: string | null;
    victimName?: string | null;
    severity?: string | null;
    triageColour?: string | null;
    address?: string | null;
  };
  hospital?: {
    name: string;
    lat: number;
    lon: number;
    bedsAvailable?: number | null;
    specialty?: string | null;
  } | null;
  unit?: {
    callSign: string;
    driverName?: string | null;
    vehicleType?: string | null;
    lat?: number | null;
    lon?: number | null;
    headingDeg?: number | null;
  } | null;
  routeGeometry?: Point[] | null;
  status?: AmbulanceStatus;
  etaSeconds?: number | null;
  height?: string;
  className?: string;
  autoPlay?: boolean;
}

// Map Controller for smooth dynamic re-centering
function MapController({ center, zoom }: { center: Point; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom, { animate: true, duration: 0.8 });
  }, [center, zoom, map]);
  return null;
}

// Siren Audio Synthesizer (Hi-Lo tone standard in India/UK emergency vehicles)
class SirenAudio {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private timer: any = null;
  private isHi = false;

  start() {
    if (typeof window === "undefined") return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.osc = this.ctx.createOscillator();
      this.gain = this.ctx.createGain();

      this.osc.type = "sawtooth";
      this.osc.frequency.setValueAtTime(770, this.ctx.currentTime);
      this.gain.gain.setValueAtTime(0.04, this.ctx.currentTime); // Low non-intrusive volume

      this.osc.connect(this.gain);
      this.gain.connect(this.ctx.destination);
      this.osc.start();

      this.timer = setInterval(() => {
        if (!this.ctx || !this.osc) return;
        this.isHi = !this.isHi;
        const targetFreq = this.isHi ? 960 : 770;
        this.osc.frequency.exponentialRampToValueAtTime(
          targetFreq,
          this.ctx.currentTime + 0.35
        );
      }, 550);
    } catch (_) {}
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.osc) {
      try {
        this.osc.stop();
        this.osc.disconnect();
      } catch (_) {}
    }
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch (_) {}
    }
    this.ctx = null;
    this.osc = null;
    this.gain = null;
  }
}

export default function LiveAmbulanceMap({
  scene,
  hospital,
  unit,
  routeGeometry,
  status = "en_route",
  etaSeconds = 280,
  height = "460px",
  className = "",
  autoPlay = true,
}: LiveAmbulanceMapProps) {
  // Animation State
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1);
  const [progress, setProgress] = useState(0.15); // Start mid-route for demonstration
  const [isSirenOn, setIsSirenOn] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const sirenRef = useRef<SirenAudio | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute Full Route Geometry
  const points: Point[] = useMemo(() => {
    if (routeGeometry && routeGeometry.length > 1) {
      return routeGeometry;
    }
    // Fallback: build realistic curved route between unit depot, scene, and hospital
    const unitStart: Point =
      unit?.lat != null && unit?.lon != null
        ? [unit.lat, unit.lon]
        : [scene.lat + 0.024, scene.lon - 0.028]; // Realistic ~3.5km depot offset

    if (hospital) {
      const legToScene = generateCurvedRoute(unitStart, [scene.lat, scene.lon], 12);
      const legToHospital = generateCurvedRoute(
        [scene.lat, scene.lon],
        [hospital.lat, hospital.lon],
        12
      );
      // Combine legs avoiding duplicate scene point
      return [...legToScene, ...legToHospital.slice(1)];
    }

    return generateCurvedRoute(unitStart, [scene.lat, scene.lon], 16);
  }, [routeGeometry, unit, scene, hospital]);

  // Current interpolated state
  const currentStep = useMemo(() => {
    return interpolateAlongPolyline(points, progress);
  }, [points, progress]);

  // Speed and dynamic telemetry
  const totalLengthM = useMemo(() => polylineLengthM(points), [points]);
  const currentSpeedKmH = useMemo(() => {
    if (!isPlaying) return 0;
    // Organic speed fluctuation around 48 km/h
    return Math.round(46 + Math.sin(progress * 20) * 8);
  }, [isPlaying, progress]);

  const liveEtaSeconds = useMemo(() => {
    const remainingM = currentStep.remainingDistanceM;
    if (remainingM <= 10) return 0;
    const speedMs = Math.max(1, (currentSpeedKmH * 1000) / 3600);
    return Math.round(remainingM / speedMs);
  }, [currentStep.remainingDistanceM, currentSpeedKmH]);

  // Animation Loop
  useEffect(() => {
    if (!isPlaying) return;

    const interval = 80; // 12.5 fps smooth increment
    const stepIncrement = (0.00045 * speedMultiplier);

    const timer = setInterval(() => {
      setProgress((prev) => {
        const next = prev + stepIncrement;
        if (next >= 1.0) {
          return 1.0;
        }
        return next;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [isPlaying, speedMultiplier]);

  // Siren Audio controller
  const toggleSiren = () => {
    if (isSirenOn) {
      sirenRef.current?.stop();
      sirenRef.current = null;
      setIsSirenOn(false);
    } else {
      sirenRef.current = new SirenAudio();
      sirenRef.current.start();
      setIsSirenOn(true);
    }
  };

  useEffect(() => {
    return () => {
      sirenRef.current?.stop();
    };
  }, []);

  // Fullscreen controller
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      if (containerRef.current.requestFullscreen) {
        containerRef.current.requestFullscreen();
      }
      setIsFullscreen(true);
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
      setIsFullscreen(false);
    }
  };

  // Trailing and Upcoming Polylines
  const completedPolyline = useMemo(() => {
    const idx = currentStep.segmentIndex;
    const pts = points.slice(0, idx + 1);
    pts.push(currentStep.position);
    return pts;
  }, [points, currentStep]);

  const remainingPolyline = useMemo(() => {
    const idx = currentStep.segmentIndex;
    const pts = [currentStep.position];
    for (let i = idx + 1; i < points.length; i++) {
      pts.push(points[i]);
    }
    return pts;
  }, [points, currentStep]);

  // Dynamic Custom Leaflet divIcons
  const ambulanceIcon = useMemo(() => {
    const heading = currentStep.heading;
    return L.divIcon({
      className: "ambulance-live-marker",
      iconSize: [48, 48],
      iconAnchor: [24, 24],
      html: `
        <div style="position: relative; width: 48px; height: 48px; display: flex; items-center; justify-content: center;">
          <!-- Pulsing Siren Beacon -->
          <div style="position: absolute; inset: 2px; border-radius: 9999px; background: rgba(14, 165, 233, 0.35); animation: ping 1.2s cubic-bezier(0, 0, 0.2, 1) infinite;"></div>
          <!-- Vehicle Disc with Dynamic Rotation -->
          <div style="position: relative; width: 38px; height: 38px; border-radius: 9999px; background: #0f172a; border: 2.5px solid #38bdf8; box-shadow: 0 0 16px rgba(56, 189, 248, 0.6); display: flex; align-items: center; justify-content: center; transform: rotate(${heading}deg); transition: transform 0.2s ease;">
            <!-- Rotating Direction Indicator Arrow -->
            <div style="position: absolute; top: 2px; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-bottom: 6px solid #f87171;"></div>
            <span style="font-size: 19px; line-height: 1; user-select: none;">🚑</span>
          </div>
          <!-- Emergency Strobe Dot -->
          <div style="position: absolute; top: -2px; right: -2px; width: 12px; height: 12px; border-radius: 9999px; background: #ef4444; border: 2px solid #ffffff; box-shadow: 0 0 8px #ef4444; animation: pulse 0.6s infinite;"></div>
        </div>
      `,
    });
  }, [currentStep.heading]);

  const sceneIcon = useMemo(() => {
    return L.divIcon({
      className: "scene-live-marker",
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      html: `
        <div style="position: relative; width: 36px; height: 36px; display: flex; flex-direction: column; align-items: center;">
          <div style="position: absolute; bottom: 0; width: 14px; height: 14px; background: rgba(239, 68, 68, 0.4); border-radius: 9999px; animation: ping 1.4s infinite;"></div>
          <div style="width: 32px; height: 32px; border-radius: 9999px; background: #dc2626; border: 2.5px solid #ffffff; box-shadow: 0 4px 10px rgba(220, 38, 38, 0.5); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 15px;">
            🚨
          </div>
        </div>
      `,
    });
  }, []);

  const hospitalIcon = useMemo(() => {
    return L.divIcon({
      className: "hospital-live-marker",
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      html: `
        <div style="position: relative; width: 36px; height: 36px; display: flex; flex-direction: column; align-items: center;">
          <div style="width: 32px; height: 32px; border-radius: 8px; background: #2563eb; border: 2.5px solid #ffffff; box-shadow: 0 4px 10px rgba(37, 99, 235, 0.4); display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 16px;">
            🏥
          </div>
        </div>
      `,
    });
  }, []);

  // Format mm:ss
  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const statusLabel =
    progress >= 0.99
      ? "ARRIVED AT DESTINATION"
      : progress >= 0.5 && hospital
      ? "TRANSPORTING TO HOSPITAL"
      : "EN ROUTE TO SCENE";

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-2xl ${className}`}
      style={{ height: isFullscreen ? "100vh" : height }}
    >
      {/* Dynamic Telemetry HUD Overlay Header */}
      <div className="absolute top-3 left-3 right-3 z-[500] flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        {/* Left: Unit Identity & Status */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/90 px-3 py-1.5 backdrop-blur-md shadow-md">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
            </span>
            <span className="font-mono text-xs font-bold tracking-wider text-slate-100">
              {unit?.callSign || "AMB-108-KAMRUP"}
            </span>
            <Badge
              variant="outline"
              className="border-red-500/60 bg-red-950/50 text-[10px] font-semibold uppercase text-red-300"
            >
              {statusLabel}
            </Badge>
          </div>
        </div>

        {/* Right: Live Telemetry Badges */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Speed Indicator */}
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1.5 backdrop-blur-md shadow-md text-xs font-mono text-sky-300">
            <Gauge className="size-3.5 text-sky-400" />
            <span>{currentSpeedKmH} km/h</span>
          </div>

          {/* Distance Remaining */}
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1.5 backdrop-blur-md shadow-md text-xs font-mono text-emerald-300">
            <MapPin className="size-3.5 text-emerald-400" />
            <span>
              {(currentStep.remainingDistanceM / 1000).toFixed(1)} km
            </span>
          </div>

          {/* ETA Countdown */}
          <div className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/90 px-2.5 py-1.5 backdrop-blur-md shadow-md text-xs font-mono text-amber-300">
            <Clock className="size-3.5 text-amber-400" />
            <span>{formatTime(liveEtaSeconds)}</span>
          </div>
        </div>
      </div>

      {/* Leaflet Map Canvas */}
      <MapContainer
        center={currentStep.position}
        zoom={14}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <MapController center={currentStep.position} zoom={14} />

        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />

        {/* Completed Trail Polyline (Muted Cyan) */}
        {completedPolyline.length > 1 && (
          <Polyline
            positions={completedPolyline}
            pathOptions={{
              color: "#38bdf8",
              weight: 4,
              opacity: 0.85,
            }}
          />
        )}

        {/* Remaining Planned Polyline (Dashed Cyan with Glow) */}
        {remainingPolyline.length > 1 && (
          <>
            <Polyline
              positions={remainingPolyline}
              pathOptions={{
                color: "#ffffff",
                weight: 7,
                opacity: 0.6,
              }}
            />
            <Polyline
              positions={remainingPolyline}
              pathOptions={{
                color: "#0284c7",
                weight: 4,
                opacity: 0.95,
                dashArray: "6, 8",
              }}
            />
          </>
        )}

        {/* Scene Marker */}
        <Marker position={[scene.lat, scene.lon]} icon={sceneIcon}>
          <Tooltip direction="top" offset={[0, -28]} permanent>
            <div className="text-xs font-sans">
              <p className="font-bold text-red-600">🚨 Patient Location</p>
              <p className="text-slate-700 font-medium">{scene.victimName || "Emergency Scene"}</p>
              {scene.address && <p className="text-slate-500 text-[10px]">{scene.address}</p>}
            </div>
          </Tooltip>
        </Marker>

        {/* Hospital Marker */}
        {hospital && (
          <Marker position={[hospital.lat, hospital.lon]} icon={hospitalIcon}>
            <Tooltip direction="top" offset={[0, -28]}>
              <div className="text-xs font-sans">
                <p className="font-bold text-blue-600">🏥 Receiving Hospital</p>
                <p className="text-slate-800 font-medium">{hospital.name}</p>
                {hospital.bedsAvailable != null && (
                  <p className="text-emerald-600 text-[10px]">
                    {hospital.bedsAvailable} acute beds available
                  </p>
                )}
              </div>
            </Tooltip>
          </Marker>
        )}

        {/* Moving Ambulance Marker with Rotating Heading */}
        <Marker position={currentStep.position} icon={ambulanceIcon} zIndexOffset={1000}>
          <Tooltip direction="bottom" offset={[0, 16]}>
            <div className="text-xs font-mono">
              <p className="font-bold text-sky-400">{unit?.callSign || "AMB-108"}</p>
              <p className="text-slate-600">{unit?.driverName ? `Driver: ${unit.driverName}` : "Crew on board"}</p>
              <p className="text-[10px] text-slate-500">
                Heading: {Math.round(currentStep.heading)}° · Speed: {currentSpeedKmH} km/h
              </p>
            </div>
          </Tooltip>
        </Marker>
      </MapContainer>

      {/* Floating Interactive Controls Bar at Bottom */}
      <div className="absolute bottom-3 left-3 right-3 z-[500] flex flex-wrap items-center justify-between gap-2">
        {/* Progress Bar & Playback Controls */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-700/90 bg-slate-900/95 px-3 py-2 backdrop-blur-md shadow-lg">
          <Button
            size="sm"
            variant="ghost"
            className="size-8 p-0 text-slate-200 hover:bg-slate-800"
            onClick={() => setIsPlaying(!isPlaying)}
            title={isPlaying ? "Pause Tracking" : "Resume Tracking"}
          >
            {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>

          {/* Progress Slider */}
          <div className="flex items-center gap-2 w-32 sm:w-48">
            <input
              type="range"
              min="0"
              max="1"
              step="0.005"
              value={progress}
              onChange={(e) => {
                setProgress(parseFloat(e.target.value));
              }}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-sky-400"
            />
            <span className="font-mono text-[10px] text-slate-400 w-8">
              {Math.round(progress * 100)}%
            </span>
          </div>

          {/* Speed multiplier presets */}
          <div className="flex items-center gap-1 border-l border-slate-700 pl-2">
            {[1, 2, 5].map((mult) => (
              <button
                key={mult}
                onClick={() => setSpeedMultiplier(mult)}
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                  speedMultiplier === mult
                    ? "bg-sky-600 text-white font-bold"
                    : "text-slate-400 hover:bg-slate-800"
                }`}
              >
                {mult}x
              </button>
            ))}
          </div>
        </div>

        {/* Right Tools: Siren Audio, Recenter, Fullscreen */}
        <div className="flex items-center gap-2">
          {/* Emergency Siren Audio Synthesizer Toggle */}
          <Button
            size="sm"
            variant="outline"
            className={`gap-1.5 border-slate-700 bg-slate-900/90 text-xs backdrop-blur-md shadow-md transition-all ${
              isSirenOn
                ? "border-red-500 bg-red-950/80 text-red-300 animate-pulse"
                : "text-slate-300 hover:bg-slate-800"
            }`}
            onClick={toggleSiren}
            title={isSirenOn ? "Mute Siren" : "Audible Emergency Siren"}
          >
            {isSirenOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            <span className="hidden sm:inline">{isSirenOn ? "Siren ON" : "Siren"}</span>
          </Button>

          {/* Recenter button */}
          <Button
            size="sm"
            variant="outline"
            className="size-8 p-0 border-slate-700 bg-slate-900/90 text-slate-300 backdrop-blur-md shadow-md hover:bg-slate-800"
            onClick={() => {
              // Force small state bounce to trigger map recentering
              setProgress((p) => p);
            }}
            title="Recenter on Ambulance"
          >
            <Crosshair className="size-4" />
          </Button>

          {/* Fullscreen Button */}
          <Button
            size="sm"
            variant="outline"
            className="size-8 p-0 border-slate-700 bg-slate-900/90 text-slate-300 backdrop-blur-md shadow-md hover:bg-slate-800"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Map"}
          >
            {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
