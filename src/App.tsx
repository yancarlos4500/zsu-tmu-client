import React, { useState } from 'react';
import TJSJArrivals from './components/TJSJArrivals';
import SectorMatrix from './components/SectorMatrix';
import VatsimRouteFetcher from './components/VatsimRouteFetcher';

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'arrivals' | 'sectors' | 'route'>('arrivals');

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      <div className="flex justify-center space-x-4 py-4 bg-gray-800 border-b border-gray-700">
        <button
          onClick={() => setActiveTab('arrivals')}
          className={`px-6 py-2 rounded font-medium transition-colors duration-200 ${
            activeTab === 'arrivals'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
        >
          Arrival Gates Monitor
        </button>
        <button
          onClick={() => setActiveTab('sectors')}
          className={`px-6 py-2 rounded font-medium transition-colors duration-200 ${
            activeTab === 'sectors'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
        >
          Sector Traffic Count
        </button>
         <button
          onClick={() => setActiveTab('route')}
          className={`px-6 py-2 rounded font-medium transition-colors duration-200 ${
            activeTab === 'route'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
          }`}
        >
          Route
        </button>
      </div>

      <div className="px-4">
        {activeTab === 'arrivals' && <TJSJArrivals />}
        
        {activeTab === 'sectors' && <SectorMatrix />}

        {activeTab === 'route' && <VatsimRouteFetcher />}
        
      </div>
    </div>
  );
};

export default App;
