import React, { useEffect, useState } from 'react';
import { point as turfPoint, polygon as turfPolygon  } from '@turf/helpers';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { Feature, FeatureCollection, Polygon, MultiPolygon } from 'geojson';

interface Aircraft {
  callsign: string;
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  groundspeed: number;
  flight_plan: {
    arrival: string;
  };
}

const ARRIVAL_AIRPORTS_IGNORE_ALT = ['TJSJ', 'TIST', 'TISX', 'TUPJ', 'TJIG', 'TJRV', 'TJVQ'];
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

const generateSlots = (start: Date, hours: number) => {
  const slots: Date[] = [];
  const base = new Date(start);
  base.setUTCMinutes(Math.floor(base.getUTCMinutes() / 15) * 15, 0, 0);
  for (let i = 0; i < hours * 4; i++) {
    slots.push(new Date(base.getTime() + i * 15 * 60000));
  }
  return slots;
};

const getCellColor = (sector: string, val: number) => {
  const max = SECTOR_LIMITS[sector] || 10;
  if (val > max) return 'bg-red-600 text-white';
  if (val >= max * 0.7) return 'bg-yellow-500 text-black';
  return 'bg-green-600 text-white';
};

const SectorMatrix: React.FC = () => {
  const [aircraftData, setAircraftData] = useState<Aircraft[]>([]);
  const [sectors, setSectors] = useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
  const [counts, setCounts] = useState<Record<string, number[]>>({});
  const [slots, setSlots] = useState<Date[]>([]);
  const [windowHours, setWindowHours] = useState(5);

  const estimateFuturePosition = (ac: Aircraft, minutesAhead: number): [number, number] => {
    const distanceNM = (ac.groundspeed || 450) * (minutesAhead / 60);
    const R = 3440.1;
    const d = distanceNM / R;
    const h = (ac.heading * Math.PI) / 180;
    const lat1 = (ac.latitude * Math.PI) / 180;
    const lon1 = (ac.longitude * Math.PI) / 180;

    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(h));
    const lon2 = lon1 + Math.atan2(
      Math.sin(h) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

    return [lon2 * (180 / Math.PI), lat2 * (180 / Math.PI)];
  };

  useEffect(() => {
  const fetchData = () => {
    fetch('/zsu_sector_boundaries.geojson')
      .then((res) => res.json())
      .then((data) => setSectors(data));

    fetch('https://data.vatsim.net/v3/vatsim-data.json')
      .then((res) => res.json())
      .then((data) => setAircraftData(data.pilots || []));
  };

  fetchData();
  setSlots(generateSlots(new Date(), windowHours));

  const interval = setInterval(() => {
    fetchData();
    setSlots(generateSlots(new Date(), windowHours));
  }, 15000); // 15 seconds

  return () => clearInterval(interval);
}, [windowHours]);

  useEffect(() => {
    const temp: Record<string, number[]> = {};
    ALL_SECTORS.forEach((sector) => {
      temp[sector] = Array(slots.length).fill(0);
    });

    const polygon = turfPolygon(predictionBoundary);


    aircraftData.forEach((ac) => {
      if (ac.altitude < 100) return;

        const currentPoint = turfPoint([ac.longitude, ac.latitude]);
  if (!booleanPointInPolygon(currentPoint, polygon)) return; // <- This line filters

      slots.forEach((slot, idx) => {
        const minsAhead = (slot.getTime() - new Date().getTime()) / 60000;
        if (minsAhead < 0) return;
        const [futureLon, futureLat] = estimateFuturePosition(ac, minsAhead);
        const p = turfPoint([futureLon, futureLat]);

        sectors.features.forEach((feature: Feature) => {
          const props = feature.properties as any;
          if (!ALL_SECTORS.includes(props.sector)) return;

          const altCheck = ARRIVAL_AIRPORTS_IGNORE_ALT.includes(ac.flight_plan?.arrival) || ac.altitude <= props.max_alt;

          if (altCheck && booleanPointInPolygon(p, feature as Feature<Polygon | MultiPolygon>)) {
            console.log(ac);
            temp[props.sector][idx]++;
          }
        });
      });
    });

    setCounts(temp);
  }, [aircraftData, sectors, slots]);

  const renderTable = (label: string, sectorList: string[]) => (
    <div className="mb-10">
      <h2 className="text-2xl font-semibold text-white mb-2">{label}</h2>
      <div className="overflow-x-auto rounded-lg shadow-lg border border-gray-700">
        <table className="table-auto min-w-full text-sm text-center bg-gray-800">
          <thead className="bg-blue-800 text-white sticky top-0 z-10">
            <tr>
              <th className="p-3 border-r border-blue-600">Sector / Time (Zulu)</th>
              {slots.map((s, i) => (
                <th key={i} className="p-2 border-r border-blue-600">
                  {s.toISOString().substring(11, 16)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sectorList.map(sector => (
              <tr key={sector}>
                <td className="p-2 font-semibold bg-gray-700 border border-gray-600 text-left pl-4">{sector}</td>
                {(counts[sector] || Array(slots.length).fill(0)).map((val, i) => (
                  <td key={i} className={`p-2 border border-gray-700 ${getCellColor(sector, val)}`}>{val}</td>
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
      <h1 className="text-4xl font-bold text-center text-blue-300 mb-6">Sector Traffic Count</h1>
      <div className="flex justify-center items-center gap-4 mb-6">
        <label className="text-lg font-medium">Window (hrs):</label>
        <input
          type="number"
          min={1}
          max={24}
          value={windowHours}
          onChange={(e) => setWindowHours(parseInt(e.target.value) || 1)}
          className="border border-blue-400 rounded px-3 py-1 w-24 text-center text-black focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>

      <div className="flex justify-center gap-6 text-sm text-gray-300 mb-8">
        <div className="flex items-center gap-2"><span className="w-4 h-4 bg-green-600 border rounded"></span> OK</div>
        <div className="flex items-center gap-2"><span className="w-4 h-4 bg-yellow-500 border rounded"></span> Near Limit</div>
        <div className="flex items-center gap-2"><span className="w-4 h-4 bg-red-600 border rounded"></span> Exceeded</div>
      </div>

      {renderTable('Center Sectors', CENTER_SECTORS)}
      {renderTable('Approach Sectors', APPROACH_SECTORS)}
    </div>
  );
};

export default SectorMatrix;
