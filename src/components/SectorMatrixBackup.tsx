import React, { useEffect, useState } from 'react';
import { point as turfPoint, polygon as turfPolygon } from '@turf/helpers';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import "leaflet-rotatedmarker";
import 'leaflet/dist/leaflet.css';



const icon = L.icon({
  iconUrl: '/aircraft-icons/a320.svg',
  iconSize: [30, 35],
  iconAnchor: [15, 15],
  popupAnchor: [0, -10],
});


interface Aircraft {
  callsign: string;
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  groundspeed: number;
  flight_plan?: {
    route?: string;
    arrival?: string;
    departure?: string;
  };
}

interface Fix {
  order: number;
  waypoint: string;
  lat: number;
  lon: number;
}

const zsu_airports = ['TJSJ', 'TIST', 'TISX', 'TUPJ', 'TJIG', 'TJRV', 'TJVQ'];
const TNCM_airports = ['TNCM', 'TFFG', 'TFFJ', 'TNCS', 'TQPF'];
const CENTER_SECTORS = ['Sector 2', 'Sector 4', 'Sector 6', 'Sector 8'];
const APPROACH_SECTORS = ['Sector 1', 'Sector 3', 'Sector 5', 'Sector 7', 'Sector 9'];
const ALL_SECTORS = [...CENTER_SECTORS, ...APPROACH_SECTORS];

const predictionBoundary: [number, number][][] = [[
  [-87.39818771887983, 29.806332530592016],
  [-83.59259067095657, 15.552926693016502],
  [-75.2515825549939, 5.85893352210762],
  [-53.222848031340064, 2.2559725164533546],
  [-43.988508380523, 26.208418813890106],
  [-68.47848274584, 37.196788205233716],
  [-87.39818771887983, 29.806332530592016],
]];

const roundToNext15 = (d: Date) => {
  const ms = d.getTime();
  const rem = ms % (15 * 60 * 1000);
  return new Date(ms + (rem === 0 ? 0 : 15 * 60 * 1000 - rem));
};

const generateSlots = (start: Date, hours: number) => {
  const slots: Date[] = [];
  for (let i = 0; i < hours * 4; i++) {
    slots.push(new Date(start.getTime() + i * 15 * 60000));
  }
  return slots;
};

const getCellColor = (val: number, limit: number) => {
  if (val > limit) return 'bg-red-600 text-white';
  if (val >= limit * 0.75) return 'bg-yellow-500 text-black';
  return 'bg-green-600 text-white';
};

const cleanFix = (fix: string): string => fix.split("/")[0].trim().toUpperCase();

const isValidFix = (fix: string): boolean =>
  /^[A-Z]{3,6}$/.test(fix) || /^\d{2}[NS]\d{3}[EW]$/.test(fix); // e.g., 43N050W

const parseLatLonFix = (fix: string): [number, number] | null => {
  const match = fix.match(/^(\d{2})(N|S)(\d{3})(E|W)$/i);
  if (match) {
    let lat = parseInt(match[1]);
    let lon = parseInt(match[3]);
    if (match[2].toUpperCase() === "S") lat *= -1;
    if (match[4].toUpperCase() === "W") lon *= -1;
    return [lat, lon];
  }
  return null;
};

const getFixCoord = (fix: string, fixCoords: Record<string, Fix[]>, prev?: [number, number]): [number, number] | null => {

  const clean = cleanFix(fix);
  const coordFix = parseLatLonFix(fix);
  if (coordFix) return coordFix;

  const matches = fixCoords[clean];
  if (!matches || matches.length === 0) return null;
  if (matches.length === 1 || !prev) return [matches[0].lat, matches[0].lon];

  // pick closest if duplicates
  const closest = matches.reduce((a, b) => {
    const distA = Math.hypot(a.lat - prev[0], a.lon - prev[1]);
    const distB = Math.hypot(b.lat - prev[0], b.lon - prev[1]);
    return distA < distB ? a : b;
  });
  return [closest.lat, closest.lon];
};

const getRemainingRoute = (ac: Aircraft, fixCoords: Record<string, Fix[]>): Fix[] => {
  if (!ac.flight_plan?.route) return [];

  const segments = ac.flight_plan.route
    .split(" ")
    .map(cleanFix)
    .filter(isValidFix);

  const fixes: Fix[] = [];
  let prev: [number, number] = [ac.latitude, ac.longitude];
  let foundMatch = false;

  for (const seg of segments) {
    const coord = getFixCoord(seg, fixCoords, prev);
    if (!coord) continue;

    const bearingToFix = Math.atan2(coord[1] - prev[1], coord[0] - prev[0]) * (180 / Math.PI);
    const headingDiff = Math.abs(ac.heading - bearingToFix) % 360;
    if (!foundMatch && (headingDiff <= 30 || headingDiff >= 330)) {
      foundMatch = true;
    }

    if (foundMatch) {
      fixes.push({ order: fixes.length + 1, waypoint: seg, lat: coord[0], lon: coord[1] });
    }

    prev = coord;
  }

  return fixes;
};
const SECTOR_LIMITS: Record<string, number> = {
  'Sector 1': 10,
  'Sector 2': 20,
  'Sector 3': 15,
  'Sector 4': 30,
  'Sector 5': 10,
  'Sector 6': 25,
  'Sector 7': 15,
  'Sector 8': 30,
  'Sector 9': 5,
};

const SectorMatrix: React.FC = () => {
  const [aircraftData, setAircraftData] = useState<Aircraft[]>([]);
  const [sectors, setSectors] = useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
  const [fixCoords, setFixCoords] = useState<Record<string, Fix[]>>({});
  const [counts, setCounts] = useState<Record<string, number[]>>({});
  const [present, setPresent] = useState<Record<string, number>>({});
  const [slots, setSlots] = useState<Date[]>([]);
  const [windowHours, setWindowHours] = useState(5);
  const [limits, setLimits] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    ALL_SECTORS.forEach(s => (init[s] = 8));
    return init;
  });

  useEffect(() => {
    fetch('/zsu_sector_boundaries.geojson').then(res => res.json()).then(setSectors);
  }, []);

  useEffect(() => {
  fetch('/routes.json')
  .then(res => res.json())
  .then(data => {
    const fixMap: Record<string, Fix[]> = {};
    (Object.values(data) as Fix[][]).forEach(routeFixes => {
      routeFixes.forEach(fix => {
        const wp = fix.waypoint.toUpperCase();
        if (!fixMap[wp]) fixMap[wp] = [];
        fixMap[wp].push(fix);
      });
    });
    setFixCoords(fixMap);
  });
}, []);

  useEffect(() => {
    const fetchData = () => {
      fetch('https://data.vatsim.net/v3/vatsim-data.json')
        .then(res => res.json())
        .then(data => setAircraftData(data.pilots || []));
    };
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const now = new Date();
    const start = roundToNext15(now);
    setSlots(generateSlots(start, windowHours));
  }, [windowHours]);

  useEffect(() => {
    const temp: Record<string, number[]> = {};
    const presentNow: Record<string, number> = {};
    ALL_SECTORS.forEach(s => {
      temp[s] = Array(slots.length).fill(0);
      presentNow[s] = 0;
    });

    const polygon = turfPolygon(predictionBoundary);

    aircraftData.forEach(ac => {
      if (ac.altitude < 100 || !ac.flight_plan || !ac.flight_plan.route) return;
      const currentPoint = turfPoint([ac.longitude, ac.latitude]);
      if (!booleanPointInPolygon(currentPoint, polygon)) return;
        console.log(ac);
        

      const routeFixes = getRemainingRoute(ac, fixCoords);
      if (routeFixes.length === 0) return;

      
      sectors.features.forEach(feature => {
        const props = feature.properties as any;
        if (!ALL_SECTORS.includes(props.sector)) return;
        const inside = booleanPointInPolygon(currentPoint, feature as Feature<Polygon | MultiPolygon>);
        if (inside) presentNow[props.sector]++;
      });

      slots.forEach((slot, idx) => {
        const minutesAhead = (slot.getTime() - Date.now()) / 60000;
        const fixIdx = Math.min(Math.floor((minutesAhead / (windowHours * 60)) * routeFixes.length), routeFixes.length - 1);
        const fix = routeFixes[fixIdx];
        if (!fix) return;
        const futurePoint = turfPoint([fix.lon, fix.lat]);

        sectors.features.forEach(feature => {
          const props = feature.properties as any;
          if (!ALL_SECTORS.includes(props.sector)) return;

          const maxAlt = props.max_alt ?? 60000;
          const arrival = ac.flight_plan?.arrival || '';
          const ignoreAlt = zsu_airports.includes(arrival);
          const altCheck = ignoreAlt || ac.altitude <= maxAlt;
          const inside = booleanPointInPolygon(futurePoint, feature as Feature<Polygon | MultiPolygon>);
          if (!altCheck || !inside) return;

          const isCenter = CENTER_SECTORS.includes(props.sector);
          if (isCenter && ac.altitude <= 10000) {
            const alsoInApproach = sectors.features.some(f => {
              const p = f.properties as any;
              return APPROACH_SECTORS.includes(p.sector) &&
                     booleanPointInPolygon(futurePoint, f as Feature<Polygon | MultiPolygon>);
            });
            if (alsoInApproach) return;
          }

          temp[props.sector][idx]++;
        });
      });
    });

    setCounts(temp);
    setPresent(presentNow);
  }, [aircraftData, sectors, slots, fixCoords]);

  const renderTable = (label: string, list: string[]) => (
    <div className="mb-12">
      <h2 className="text-2xl font-semibold text-white mb-2">{label}</h2>
      <div className="overflow-x-auto rounded-lg shadow-lg border border-gray-700">
        <table className="table-auto min-w-full text-sm text-center bg-gray-800">
          <thead className="bg-blue-800 text-white">
            <tr>
              <th className="p-3 border-r border-blue-600">Sector</th>
              <th className="p-3 border-r border-blue-600">Now</th>
              {slots.map((s, i) => (
                <th key={i} className="p-2 border-r border-blue-600">{s.toISOString().substring(11, 16)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map(sector => (
              <tr key={sector}>
                <td className="p-2 bg-gray-700 border border-gray-600 text-left pl-4 font-semibold">{sector}</td>
                <td className="p-2 border border-gray-700 font-bold">{present[sector] || 0}</td>
                {(counts[sector] || []).map((val, i) => (
                  <td key={i} className={`p-2 border border-gray-700 ${getCellColor(val, limits[sector])}`}>{val}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="p-6 bg-gray-900 text-white min-h-screen font-sans">
      <h1 className="text-4xl font-bold text-center text-blue-300 mb-6">Sector Traffic Matrix</h1>
      <div className="flex justify-center items-center gap-4 mb-6">
        <label className="text-lg font-medium">Window (hrs):</label>
        <input
          type="number"
          min={1}
          max={24}
          value={windowHours}
          onChange={(e) => setWindowHours(parseInt(e.target.value) || 1)}
          className="border border-blue-400 rounded px-3 py-1 w-24 text-center text-black"
        />
      </div>
      <div className="flex justify-center gap-6 text-sm text-gray-300 mb-8">
        <div className="flex items-center gap-2"><span className="w-4 h-4 bg-green-600 border rounded"></span> OK</div>
        <div className="flex items-center gap-2"><span className="w-4 h-4 bg-yellow-500 border rounded"></span> Near Limit</div>
        <div className="flex items-center gap-2"><span className="w-4 h-4 bg-red-600 border rounded"></span> Exceeded</div>
      </div>

      {renderTable('Center Sectors', CENTER_SECTORS)}
      {renderTable('Approach Sectors', APPROACH_SECTORS)}

      <div className="h-[600px] mt-12 rounded shadow overflow-hidden">
        <MapContainer center={[18.4, -66.1]} zoom={7} scrollWheelZoom className="w-full h-full z-0">
          <TileLayer
            url="https://api.mapbox.com/styles/v1/yancarlos4500/clnorn0yn008v01qugoglakdj/tiles/256/{z}/{x}/{y}?access_token=pk.eyJ1IjoieWFuY2FybG9zNDUwMCIsImEiOiJja2ZrbnQzdmExMDhnMzJwbTdlejNhdnJuIn0.aoHpGyZLaQRcp8SPYowuOQ"
          attribution="© OpenStreetMap"
          />
          {aircraftData.map(ac => {
            let color = 'gray'
            const polygon = turfPolygon(predictionBoundary);
            const currentPoint = turfPoint([ac.longitude, ac.latitude]);
              if (!booleanPointInPolygon(currentPoint, polygon)) return; // <- This line filters
              if(ac.altitude < 100) return;
            const remRoute = getRemainingRoute(ac, fixCoords);
            if (remRoute.length < 1) return null;
            const arrival = ac.flight_plan?.arrival || '';
            const departure = ac.flight_plan?.departure || '';
            if(zsu_airports.includes(departure) || TNCM_airports.includes(departure)) color = 'red'
            if(zsu_airports.includes(arrival) || TNCM_airports.includes(arrival)) color = 'green'
            if(zsu_airports.includes(departure) && zsu_airports.includes(arrival)) color = 'yellow'
            if( (zsu_airports.includes(departure) || zsu_airports.includes(arrival)) && (TNCM_airports.includes(departure) || TNCM_airports.includes(arrival)) ) color = 'yellow'
            
            return (
              <React.Fragment key={ac.callsign}>
                <Marker 
                position={[ac.latitude, ac.longitude]}
                icon={icon}
                  rotationAngle={ac.heading}
                  rotationOrigin="center center">
                  
                  <Popup>{ac.callsign}</Popup>
                </Marker>
                <Polyline
                  positions={[
                    [ac.latitude, ac.longitude],
                    ...remRoute.map(fix => [fix.lat, fix.lon] as [number, number])
                  ]}
                  color = {color}
                  weight={3}
                />
              </React.Fragment>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
};

export default SectorMatrix;
