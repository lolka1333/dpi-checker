import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, WifiOff, AlertTriangle, CheckCircle, XCircle, Clock, Zap, Terminal } from 'lucide-react';

interface TestCase {
  id: string;
  provider: string;
  times: number;
  url: string;
}

interface TestResult {
  id: string;
  provider: string;
  status: 'checking' | 'ok' | 'bad' | 'warning' | 'failed';
  statusText: string;
  httpStatus?: number;
}

interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERR';
  prefix?: string;
  message: string;
}

const DPIChecker: React.FC = () => {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<'ready' | 'checking' | 'error'>('ready');
  const [statusText, setStatusText] = useState('Ready ⚡');
  const [results, setResults] = useState<TestResult[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const URL_CHECK_NETWORK = "https://one.one.one.one/favicon.ico";
  const TEST_SUITE: TestCase[] = [
    { id: "CF-02", provider: "Cloudflare", times: 1, url: "https://genshin.jmp.blue/characters/all#" },
    { id: "CF-03", provider: "Cloudflare", times: 1, url: "https://api.frankfurter.dev/v1/2000-01-01..2002-12-31" },
    { id: "DO-01", provider: "DigitalOcean", times: 2, url: "https://genderize.io/" },
    { id: "HE-01", provider: "Hetzner", times: 2, url: "https://bible-api.com/john+1,2,3,4,5,6,7,8,9,10" },
    { id: "HE-02", provider: "Hetzner", times: 1, url: "https://tcp1620-01.dubybot.live/1MB.bin" },
    { id: "HE-03", provider: "Hetzner", times: 1, url: "https://tcp1620-02.dubybot.live/1MB.bin" },
    { id: "HE-04", provider: "Hetzner", times: 1, url: "https://tcp1620-05.dubybot.live/1MB.bin" },
    { id: "HE-05", provider: "Hetzner", times: 1, url: "https://tcp1620-06.dubybot.live/1MB.bin" },
    { id: "OVH-01", provider: "OVH", times: 1, url: "https://eu.api.ovh.com/console/rapidoc-min.js" },
    { id: "OR-01", provider: "Oracle", times: 1, url: "https://sfx.ovh/10M.bin" },
  ];

  const OK_THRESHOLD_BYTES = 64 * 1024;
  const TIMEOUT_MS = 5000;

  const httpCodes = useRef<{[key: string]: number}>({});

  const addLog = (level: 'INFO' | 'WARN' | 'ERR', prefix: string | null, message: string) => {
    const now = new Date();
    const timestamp = now.toLocaleTimeString([], { hour12: false }) + "." + now.getMilliseconds().toString().padStart(3, "0");
    const newLog: LogEntry = {
      timestamp,
      level,
      prefix: prefix || undefined,
      message
    };
    
    setLogs(prev => [...prev, newLog]);
  };

  const timeElapsed = (t0: number): string => `${(performance.now() - t0).toFixed(1)} ms`;

  const getUniqueUrl = (url: string): string => {
    return url.includes('?') ? `${url}&t=${Math.random()}` : `${url}?t=${Math.random()}`;
  };

  const fetchOpt = (ctrl: AbortController): RequestInit => ({
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    signal: ctrl.signal,
    redirect: "manual",
    keepalive: true
  });

  const updateResult = (id: string, updates: Partial<TestResult>) => {
    setResults(prev => prev.map(result => 
      result.id === id ? { ...result, ...updates } : result
    ));
  };

  const checkDpi = async (id: string, provider: string, url: string): Promise<void> => {
    const prefix = `DPI checking(#${id})`;
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    // Add result to table
    setResults(prev => [...prev, {
      id,
      provider,
      status: 'checking',
      statusText: 'Checking ⏰'
    }]);

    try {
      const r = await fetch(getUniqueUrl(url), fetchOpt(ctrl));
      addLog("INFO", prefix, `HTTP ${r.status}`);
      httpCodes.current[id] = r.status;
      
      if (!r.body) {
        throw new Error("No response body");
      }

      const reader = r.body.getReader();
      let received = 0;
      let ok = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          clearTimeout(timeoutId);
          addLog("INFO", prefix, `Stream complete without timeout (${timeElapsed(t0)})`);
          if (!ok) {
            addLog("WARN", prefix, `Stream ended but data is too small`);
            updateResult(id, { status: 'warning', statusText: 'Possibly detected ⚠️' });
          }
          break;
        }

        received += value.byteLength;
        addLog("INFO", prefix, `Received chunk: ${value.byteLength} bytes, total: ${received}`);

        if (!ok && received >= OK_THRESHOLD_BYTES) {
          clearTimeout(timeoutId);
          await reader.cancel();
          ok = true;
          addLog("INFO", prefix, `Early complete (${timeElapsed(t0)})`);
          updateResult(id, { status: 'ok', statusText: 'Not detected ✅' });
          break;
        }
      }
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof Error && e.name === "AbortError") {
        const httpStatus = httpCodes.current[id];
        const reason = httpStatus ? "READ" : "CONN";
        addLog("ERR", prefix, `${reason} timeout reached (${timeElapsed(t0)})`);
        updateResult(id, { 
          status: 'bad', 
          statusText: httpStatus ? "Detected❗️" : "Detected*❗️",
          httpStatus 
        });
      } else {
        addLog("ERR", prefix, `Fetch/read error => ${e}`);
        updateResult(id, { status: 'failed', statusText: 'Failed to complete detection ⚠️' });
      }
    }
  };

  const checkNetwork = async (): Promise<void> => {
    setStatus('checking');
    setStatusText('Checking ⏰');
    setResults([]);
    
    const prefix = "Network checking";
    const t0 = performance.now();
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    try {
      const r = await fetch(getUniqueUrl(URL_CHECK_NETWORK), fetchOpt(ctrl));
      if (!r.ok) throw new Error("Bad response");
      await r.blob();
      addLog("INFO", prefix, `OK (${timeElapsed(t0)})`);

      // Run all tests
      const tasks = [];
      for (const test of TEST_SUITE) {
        for (let i = 0; i < test.times; i++) {
          const testId = test.times > 1 ? `${test.id}/${i}` : test.id;
          tasks.push(checkDpi(testId, test.provider, test.url));
        }
      }

      await Promise.all(tasks);
      setStatus('ready');
      setStatusText('Ready ⚡');
    } catch {
      addLog("ERR", prefix, `FAILED (${timeElapsed(t0)})`);
      setStatus('error');
      setStatusText('No internet access ⚠️');
    }
    
    addLog("INFO", null, "Done.");
    setIsRunning(false);
  };

  const handleStart = () => {
    setLogs([]);
    setIsRunning(true);
    httpCodes.current = {};
    checkNetwork();
  };

  const handleStop = () => {
    setIsRunning(false);
    setStatus('ready');
    setStatusText('Ready ⚡');
  };

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const getStatusIcon = () => {
    switch (status) {
      case 'ready': return <Zap className="w-5 h-5 text-emerald-500" />;
      case 'checking': return <Clock className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'error': return <WifiOff className="w-5 h-5 text-red-500" />;
    }
  };

  const getResultIcon = (result: TestResult) => {
    switch (result.status) {
      case 'checking': return <Clock className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'ok': return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'bad': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case 'failed': return <AlertTriangle className="w-4 h-4 text-gray-500" />;
    }
  };

  const getResultColor = (result: TestResult) => {
    switch (result.status) {
      case 'ok': return 'text-emerald-600 font-medium';
      case 'bad': return 'text-red-600 font-medium';
      case 'warning': return 'text-amber-600 font-medium';
      case 'failed': return 'text-gray-600 font-medium';
      default: return 'text-blue-600';
    }
  };

  const getProviderColor = (provider: string) => {
    const colors = {
      'Cloudflare': 'bg-orange-100 text-orange-800',
      'DigitalOcean': 'bg-blue-100 text-blue-800',
      'Hetzner': 'bg-red-100 text-red-800',
      'OVH': 'bg-purple-100 text-purple-800',
      'Oracle': 'bg-red-100 text-red-800',
    };
    return colors[provider as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-3 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-4 sm:p-6 mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
                DPI Checker
              </h1>
              <p className="text-gray-600 text-sm sm:text-base">
                TCP 16-20 DPI Detection Tool
              </p>
            </div>
            
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                {getStatusIcon()}
                <span className={`font-semibold text-sm ${
                  status === 'ready' ? 'text-emerald-600' : 
                  status === 'checking' ? 'text-blue-600' : 'text-red-600'
                }`}>
                  {statusText}
                </span>
              </div>
              
              <button
                onClick={isRunning ? handleStop : handleStart}
                disabled={status === 'checking'}
                className={`
                  flex items-center justify-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all
                  ${isRunning || status === 'checking'
                    ? 'bg-gray-400 text-white cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white shadow-lg hover:shadow-xl'
                  }
                `}
              >
                {isRunning || status === 'checking' ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                {isRunning || status === 'checking' ? 'Running...' : 'Start Test'}
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Results */}
          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-indigo-600 px-4 py-3">
              <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                <CheckCircle className="w-5 h-5" />
                Test Results
              </h2>
            </div>
            
            <div className="custom-scrollbar overflow-y-auto" style={{ maxHeight: '400px' }}>
              {results.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                    <Play className="w-8 h-8 text-gray-400" />
                  </div>
                  <p>Click "Start Test" to begin DPI detection</p>
                </div>
              ) : (
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">ID</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">Provider</th>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-700">DPI Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {results.map((result) => (
                      <tr key={result.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded font-medium">{result.id}</span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${getProviderColor(result.provider)}`}>
                            {result.provider}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {getResultIcon(result)}
                            <span className={`text-sm font-medium ${getResultColor(result)}`}>
                              {result.statusText}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Logs */}
          <div className="bg-white rounded-xl shadow-lg overflow-hidden">
            <div className="bg-gradient-to-r from-gray-700 to-gray-800 px-4 py-3">
              <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                <Terminal className="w-5 h-5" />
                Console Logs
                {logs.length > 0 && (
                  <span className="bg-white/20 text-xs px-2 py-1 rounded-full ml-2">
                    {logs.length}
                  </span>
                )}
              </h2>
            </div>
            
            <div 
              ref={logRef}
              className="bg-gray-900 text-green-400 p-4 custom-scrollbar overflow-y-auto font-mono text-xs"
              style={{ height: '400px' }}
            >
              {logs.length === 0 ? (
                <div className="text-gray-500 text-center py-8">
                  Logs will appear here after starting the test...
                </div>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className="mb-1 whitespace-pre-wrap break-words">
                    <span className="text-gray-500 text-xs">{log.timestamp}</span>
                    {log.prefix && <span className="text-cyan-400 text-xs"> {log.prefix}</span>}
                    <span className={`text-xs font-bold ${
                      log.level === 'ERR' ? 'text-red-400' : 
                      log.level === 'WARN' ? 'text-amber-400' : 'text-emerald-400'
                    }`}> {log.level}</span>
                    <span className="text-gray-300 text-xs">: {log.message}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-white rounded-xl shadow-lg p-4 mt-6 text-center space-y-2">
          <p className="text-gray-600 text-sm">
            💡 <strong className="text-blue-600">DPI[tcp 16-20]</strong> detection method • 
            <a 
              href="https://github.com/net4people/bbs/issues/490" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 transition-colors ml-1 underline"
            >
              Learn more
            </a>
          </p>
          <p className="text-gray-600 text-sm">
            Open source • 
            <a 
              href="https://github.com/hyperion-cs/dpi-checkers" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 transition-colors ml-1 underline"
            >
              View on GitHub
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default DPIChecker;