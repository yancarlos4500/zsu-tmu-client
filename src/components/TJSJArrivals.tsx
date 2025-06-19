import React, { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
// const socket = io('http://localhost:3001');
const socket = io('zsu-tmu-server-production.up.railway.app');

const GATES = ['SAALR', 'BEANO', 'JOSHE', 'VEDAS', 'STT'];
const TJSJ_COORDS = { lat: 18.4394, lon: -66.0018 };

const roundToNext15 = (d: Date) => {
  const ms = d.getTime();
  const rem = ms % (15 * 60 * 1000);
  return new Date(ms + (rem ? 15 * 60 * 1000 - rem : 0));
};

const generateSlots = (start: Date, totalHours: number) => {
  const slots: Date[] = [];
  let cur = new Date(start);
  const end = new Date(start.getTime() + totalHours * 3600 * 1000);
  while (cur < end) {
    slots.push(new Date(cur));
    cur = new Date(cur.getTime() + 15 * 60 * 1000);
  }
  return slots;
};

const bucketIndex = (d: Date, slots: Date[]) => {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    if (d >= s && d < new Date(s.getTime() + 15 * 60 * 1000)) return i;
  }
  return -1;
};

const getDistanceNM = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const toRad = (deg: number) => deg * (Math.PI / 180);
  const R = 3440.1; // nautical miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const TJSJArrivals: React.FC = () => {
  const [slots, setSlots] = useState<Date[]>([]);
  const [counts, setCounts] = useState<Record<string, number[]>>({});
  const [windowHours, setWindowHours] = useState<number>(5);
  const [limits, setLimits] = useState<Record<string, number>>(Object.fromEntries(GATES.map(g => [g, 4])));
  const tableRef = useRef<HTMLDivElement>(null);

 const handleLimitChange = (gate: string, value: number) => {
  const newLimits = { ...limits, [gate]: value };
  setLimits(newLimits);
  socket.emit('updateLimits', newLimits); // 🔁 Real-time sync across devices
};

  useEffect(() => {
  socket.on('limits', (incomingLimits) => {
    setLimits(incomingLimits);
  });

  const fetchData = async () => {
    const nowUtc = new Date(new Date().toISOString());
    const start = roundToNext15(nowUtc);
    const slotSet = generateSlots(start, windowHours);
    const countInit = GATES.reduce((o, g) => {
      o[g] = Array(slotSet.length).fill(0);
      return o;
    }, {} as Record<string, number[]>);

    try {
      const response = await fetch('https://data.vatsim.net/v3/vatsim-data.json');
      const data = await response.json();

      const arrivals = data.pilots.filter((p: any) => p.flight_plan?.arrival === 'TJSJ');

      arrivals.forEach((p: any) => {
        if (p.altitude < 100) return;
        const distanceNM = getDistanceNM(p.latitude, p.longitude, TJSJ_COORDS.lat, TJSJ_COORDS.lon);
        const speed = p.groundspeed || 450;
        const msToDest = (distanceNM / speed) * 60 * 60 * 1000;
        const eta = new Date(Date.now() + msToDest);

        const idx = bucketIndex(eta, slotSet);
        if (idx === -1) return;

        const route = p.flight_plan.route?.toUpperCase() || '';
        const gate = GATES.find(g => route.includes(g)) || 'UNKNOWN';

        if (!countInit[gate]) countInit[gate] = Array(slotSet.length).fill(0);
        countInit[gate][idx]++;
      });

      setSlots(slotSet);
      setCounts(countInit);
    } catch (err) {
      console.error('Fetch error:', err);
    }
  };

  fetchData();
  const interval = setInterval(fetchData, 15000);

  return () => {
    socket.off('limits');
    clearInterval(interval);
  };
}, [windowHours]);


  const getCellColor = (val: number, limit: number) => {
    if (val > limit) return 'bg-red-600 text-white';
    if (val >= limit * 0.75) return 'bg-yellow-500 text-black';
    return 'bg-green-600 text-white';
  };

  const isCurrentSlot = (slot: Date) => {
    const now = new Date();
    return now >= slot && now < new Date(slot.getTime() + 15 * 60 * 1000);
  };

  return (
    <div className="p-6 bg-gray-900 text-white min-h-screen space-y-12 font-sans">
      <h1 className="text-4xl font-bold text-center text-blue-300">SJU Arrival Gates Monitor</h1>

      <div className="flex justify-center items-center gap-4">
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

      <div className="flex justify-center gap-6 text-sm text-gray-300">
        <div className="flex items-center gap-2"><span className="w-4 h-4 bg-green-600 border rounded"></span> OK</div>
        <div className="flex items-center gap-2"><span className="w-4 h-4 bg-yellow-500 border rounded"></span> Near Limit</div>
        <div className="flex items-center gap-2"><span className="w-4 h-4 bg-red-600 border rounded"></span> Exceeded</div>
      </div>

      <div className="overflow-x-auto rounded-lg shadow-lg border border-gray-700" ref={tableRef}>
        <table className="table-auto min-w-full text-sm text-center bg-gray-800">
          <thead className="bg-blue-800 text-white sticky top-0 z-10">
            <tr>
              <th className="p-3 border-r border-blue-600">Gate / Time (Zulu)</th>
              {slots.map((s, i) => (
                <th
                  key={i}
                  className={`p-2 border-r border-blue-600 ${isCurrentSlot(s) ? 'bg-blue-400 font-bold' : ''}`}
                >
                  {s.toISOString().substring(11, 16)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GATES.map((g) => (
              <tr key={g}>
                <td className="p-2 font-semibold bg-gray-700 border border-gray-600 text-left pl-4">{g}</td>
                {slots.map((_, i) => (
                  <td
                    key={i}
                    className={`p-2 border border-gray-700 ${getCellColor(counts[g]?.[i] || 0, limits[g])}`}
                  >
                    {counts[g]?.[i] ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="max-w-xl mx-auto bg-gray-800 shadow-md rounded-lg p-6 border border-gray-700">
        <h2 className="text-xl font-semibold text-center text-white mb-4">Set Gate Entry Limits</h2>
        <table className="table-auto w-full text-sm text-white">
          <thead className="bg-gray-700">
            <tr>
              <th className="p-2 border border-gray-600">Gate</th>
              <th className="p-2 border border-gray-600">Max per Slot</th>
            </tr>
          </thead>
          <tbody>
            {GATES.map(g => (
              <tr key={g}>
                <td className="p-2 border border-gray-600 text-left font-medium">{g}</td>
                <td className="p-2 border border-gray-600 text-center">
                  <input
                    type="number"
                    value={limits[g]}
                    onChange={(e) => handleLimitChange(g, parseInt(e.target.value))}
                    className="w-20 px-2 py-1 border rounded text-center text-black focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TJSJArrivals;
