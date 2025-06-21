import React, { useEffect, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-rotatedmarker";
import { MapContainer, TileLayer, Polyline, Marker, Popup } from "react-leaflet";
import routesDataRaw from "../routes.json";
import airportRaw from "../airports.json";

import { log } from "node:console";

const icon = L.icon({
  iconUrl: '/aircraft-icon.png',
  iconSize: [30, 35],
  iconAnchor: [15, 15],
  popupAnchor: [0, -10],
});

interface FlightPlan {
  departure: string;
  arrival: string;
  route: string;
}

interface Pilot {
  cid: number;
  callsign: string;
  flight_plan?: FlightPlan;
  latitude: number;
  longitude: number;
  heading: number;
  altitude: number;
  groundspeed: number;
}

interface Waypoint {
  order: number;
  waypoint: string;
  lat: number;
  lon: number;
}

interface AirportEntry {
  icao: string;
  iata: string | null;
  name: string;
  city: string;
  state: string;
  country: string;
  elevation: number;
  lat: number;
  lon: number;
  tz: string;
}

interface RouteData {
  [airway: string]: Waypoint[];
}

const routesData: RouteData = routesDataRaw;
const airportDB = airportRaw as Record<string, AirportEntry>;


const predictionBoundary: [number, number][][] = [[
  [29.806332530592016, -87.39818771887983],
  [15.552926693016502, -83.59259067095657],
  [5.85893352210762, -75.2515825549939],
  [2.2559725164533546, -53.222848031340064],
  [26.208418813890106, -43.988508380523],
  [37.196788205233716, -68.47848274584],
  [29.806332530592016, -87.39818771887983],
]];

function isInBoundary(lat: number, lon: number): boolean {
  const point = L.latLng(lat, lon);
  const bounds = L.polygon(predictionBoundary);
  return bounds.getBounds().contains(point);
}

function bearingBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  const brng = Math.atan2(y, x);
  return (brng * 180 / Math.PI + 360) % 360;
}

function headingMatches(current: number, target: number, tolerance = 30): boolean {
  const diff = Math.abs(current - target);
  return diff <= tolerance || diff >= 360 - tolerance;
}

function parseLatLonFix(fix: string): [number, number] | null {
  // Examples: 43N050W, 46N040W, 48N030W
  const match = fix.match(/^(\d{2})(N|S)(\d{3})(E|W)$/i);
  if (match) {
    let lat = parseInt(match[1]);
    let lon = parseInt(match[3]);

    if (match[2].toUpperCase() === "S") lat *= -1;
    if (match[4].toUpperCase() === "W") lon *= -1;

    return [lat, lon];
  }

  // Optionally support 5-digit coordinates like 205705N0655304W
  const longForm = fix.match(/^(\d{2})(\d{2})(\d{2})(N|S)(\d{3})(\d{2})(\d{2})(E|W)$/i);
  if (longForm) {
    const latDeg = parseInt(longForm[1]);
    const latMin = parseInt(longForm[2]);
    const latSec = parseInt(longForm[3]);
    const latHem = longForm[4];

    const lonDeg = parseInt(longForm[5]);
    const lonMin = parseInt(longForm[6]);
    const lonSec = parseInt(longForm[7]);
    const lonHem = longForm[8];

    let lat = latDeg + latMin / 60 + latSec / 3600;
    let lon = lonDeg + lonMin / 60 + lonSec / 3600;

    if (latHem.toUpperCase() === "S") lat *= -1;
    if (lonHem.toUpperCase() === "W") lon *= -1;

    return [lat, lon];
  }

  return null;
}


function estimateFuturePositions(
  start: [number, number],
  path: [number, number][],
  groundspeed: number
): { coord: [number, number]; eta: string }[] {
  const result: { coord: [number, number]; eta: string }[] = [];
  if (path.length === 0 || groundspeed <= 0) return result;

  const NM_PER_MIN = groundspeed / 60;
  let eta = new Date();
  let prev = start;

  for (let i = 0; i < path.length; i++) {
    const next = path[i];
    const dist = haversineDistance(prev, next);
    const mins = dist / NM_PER_MIN;
    eta = new Date(eta.getTime() + mins * 60 * 1000);

    result.push({ coord: [next[0], next[1]], eta: eta.toISOString().split("T")[1]?.slice(0, 5) + "Z" });
    prev = next;
  }

  return result;
}


function haversineDistance([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const R = 6371; // km
  const toRad = (deg: number) => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const isValidFix = (fix: string): boolean => {
  const cleaned = fix.split("/")[0].toUpperCase();
  return /^[A-Z]{3,5}$/.test(cleaned) || /^\d{2}N\d{3}W$/.test(cleaned) || /^\d{2}S\d{3}W$/.test(cleaned) || /^\d{2}N\d{3}E$/.test(cleaned) || /^\d{2}S\d{3}E$/.test(cleaned);
};

const airportCoords: { [icao: string]: [number, number] } = {
  TJSJ: [18.4394, -66.0018],
  TNCM: [18.041, -63.109],
  TIST: [18.3373, -64.9734],
  TISX: [17.7019, -64.7983],
  TUPJ: [18.4458, -64.543],
  MDPC: [18.5674, -68.3634],
  MDSD: [18.4297, -69.6689],
  MBPV: [21.7736, -72.2659],
  MTPP: [18.579, -72.2925],
};

export default function VatsimRouteFetcher() {
  const [pilots, setPilots] = useState<Pilot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("https://data.vatsim.net/v3/vatsim-data.json")
      .then((res) => res.json())
      .then((data) => {
        const withRoutes = data.pilots.filter(
          (p: Pilot) =>
            p.flight_plan &&
            p.flight_plan.route &&
            p.altitude > 100 &&
            isInBoundary(p.latitude, p.longitude)
        );
        setPilots(withRoutes);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to fetch VATSIM data", err);
        setLoading(false);
      });
  }, []);

  const cleanFix = (fix: string): string =>
  fix.split("/")[0].trim().toUpperCase();

  const isSidStar = (fix: string): boolean =>
  /^[A-Z]+\d+[A-Z]$/.test(fix);

const getFixCoordAndName = (fix: string, prev?: [number, number]): { coord: [number, number], name: string } | null => {
  const clean = cleanFix(fix);
  const coordFix = parseLatLonFix(fix);
  console.log(coordFix)
  if (coordFix) return { coord: coordFix, name: clean };

  const matches = Object.values(routesData).flat().filter(wp => wp.waypoint === clean);
  if (matches.length === 0) return null;

  if (matches.length === 1 || !prev) {
    const wp = matches[0];
    return { coord: [wp.lat, wp.lon], name: wp.waypoint };
  }

  // Pick closest to previous fix
  const closest = matches.reduce((a, b) => {
    const distA = haversineDistance(prev, [a.lat, a.lon]);
    const distB = haversineDistance(prev, [b.lat, b.lon]);
    return distA < distB ? a : b;
  });

  return { coord: [closest.lat, closest.lon], name: closest.waypoint };
};


  const extractRemainingRoute = (route: string, lat: number, lon: number, heading: number, gs: number, arrival: string): { path: [number, number][], labels: { coord: [number, number], name: string, dist: number, eta: string }[], future: { coord: [number, number], eta: string }[] } => {
    const segments = route.split(" ").map(cleanFix).filter(isValidFix);
    const path: [number, number][] = [];
    const labels: { coord: [number, number], name: string, dist: number, eta: string }[] = [];

    let matchFound = false;
    let lastCoord: [number, number] = [lat, lon];
    let time = new Date();

    for (let i = 0; i < segments.length; i++) {
  const fix = segments[i];
  const nextFix = segments[i + 1];
  const fixData = getFixCoordAndName(fix, lastCoord);
  console.log(fix);
  
  if (!fixData) continue;

  const brng = bearingBetween(lat, lon, fixData.coord[0], fixData.coord[1]);
  if (!matchFound && headingMatches(heading, brng)) matchFound = true;

  if (matchFound) {
    const dist = haversineDistance(lastCoord, fixData.coord);
    const min = (dist * 0.539957) / gs * 60;
    time = new Date(time.getTime() + min * 60000);
    path.push(fixData.coord);
    labels.push({ coord: fixData.coord, name: fixData.name, dist: dist * 0.539957, eta: time.toUTCString().split(" ")[4] + "Z" });

    // Inject intermediate fixes if both current and next fix are on same airway
    if (nextFix) {
      const cleanNext = cleanFix(nextFix);
      const matches1 = Object.entries(routesData).filter(([_, wps]) => wps.some(w => w.waypoint === fixData.name));
      const matches2 = Object.entries(routesData).filter(([_, wps]) => wps.some(w => w.waypoint === cleanNext));

      const sharedAirway = matches1.find(([airway1]) => matches2.some(([airway2]) => airway2 === airway1));
      if (sharedAirway) {
        const airwayFixes = sharedAirway[1];
        const idx1 = airwayFixes.findIndex(wp => wp.waypoint === fixData.name);
        const idx2 = airwayFixes.findIndex(wp => wp.waypoint === cleanNext);
        if (idx1 !== -1 && idx2 !== -1 && Math.abs(idx2 - idx1) > 1) {
          const slice = idx1 < idx2 ? airwayFixes.slice(idx1 + 1, idx2) : airwayFixes.slice(idx2 + 1, idx1).reverse();
          for (const wp of slice) {
            const coord: [number, number] = [wp.lat, wp.lon];
            const dist = haversineDistance(lastCoord, coord);
            const min = (dist * 0.539957) / gs * 60;
            time = new Date(time.getTime() + min * 60000);
            path.push(coord);
            labels.push({ coord, name: wp.waypoint, dist: dist * 0.539957, eta: time.toUTCString().split(" ")[4] + "Z" });
            lastCoord = coord;
          }
        }
      }
    }

    lastCoord = fixData.coord;
  }
}


    const dest = arrival.toUpperCase();
let destCoord: [number, number] | undefined = airportCoords[dest];

if (!destCoord && airportDB[dest]) {
  const ap = airportDB[dest];
  if (ap && typeof ap.lat === "number" && typeof ap.lon === "number") {
    destCoord = [ap.lat, ap.lon];
  }
}
    if (matchFound && destCoord) {
  const dist = haversineDistance(lastCoord, destCoord);
  const min = (dist * 0.539957) / gs * 60;
  time = new Date(time.getTime() + min * 60000);
  path.push(destCoord);
  labels.push({ coord: destCoord, name: dest, dist: dist * 0.539957, eta: time.toUTCString().split(" ")[4] + "Z" });
}

    const future = estimateFuturePositions([lat, lon], path, gs);
    return { path, labels, future };
  };

  return (
    <div className="w-full h-screen">
      {loading ? (
        <p className="text-white p-4">Loading...</p>
      ) : (
        <MapContainer center={[20, -70]} zoom={4} style={{ height: "100%", width: "100%" }}>
         <TileLayer
                     url="https://api.mapbox.com/styles/v1/yancarlos4500/clnorn0yn008v01qugoglakdj/tiles/256/{z}/{x}/{y}?access_token=pk.eyJ1IjoieWFuY2FybG9zNDUwMCIsImEiOiJja2ZrbnQzdmExMDhnMzJwbTdlejNhdnJuIn0.aoHpGyZLaQRcp8SPYowuOQ"
                   attribution="© OpenStreetMap"
                   />
          {pilots.map((pilot) => {
            const { path, labels, future } = extractRemainingRoute(pilot.flight_plan!.route, pilot.latitude, pilot.longitude, pilot.heading, pilot.groundspeed, pilot.flight_plan!.arrival);
            const nextRoute = [
              [pilot.latitude, pilot.longitude],
              ...path
            ];

            return (
              <React.Fragment key={pilot.cid}>
                {nextRoute.length > 1 && (
                  <Polyline
                    positions={nextRoute as [number, number][]}
                    pathOptions={{ color: "lime", weight: 2 }}
                  />
                )}
                {labels.map((label, idx) => (
                  <Marker
                    key={`${pilot.cid}-fix-${idx}`}
                    position={label.coord}
                    icon={L.divIcon({
                      html: `<div style="color: cyan; font-size: 20px;">▲<div style="font-size:12px; position: relative; top: -5px; left:-5px;">${label.name}<br/>${label.dist.toFixed(0)} NM<br/>ETA ${label.eta}</div></div>`,
                      className: '',
                      iconSize: [30, 30]
                    })}
                  />
                ))}
                {future.map((pt, idx) => (
                  <Marker
                    key={`${pilot.cid}-future-${idx}`}
                    position={pt.coord}
                    icon={L.divIcon({
                      html: `<div style="color: yellow; font-size: 16px;">•<div style="font-size:10px; position: relative; top: -5px; left:-5px;">${pt.eta}</div></div>`,
                      className: '',
                      iconSize: [20, 20]
                    })}
                  />
                ))}
                <Marker
                  position={[pilot.latitude, pilot.longitude]}
                  icon={icon}
                  rotationAngle={pilot.heading}
                  rotationOrigin="center center"
                >
                  <Popup>
                    {pilot.callsign}<br />
                    {pilot.flight_plan?.departure} ➔ {pilot.flight_plan?.arrival}<br />
                    <strong>Remaining Route:</strong><br />
                    {labels.map(l => l.name).join(" ➔ ")}
                  </Popup>
                </Marker>
              </React.Fragment>
            );
          })}
        </MapContainer>
      )}
    </div>
  );
}
