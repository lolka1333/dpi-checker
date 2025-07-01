import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Wifi, WifiOff, AlertTriangle, CheckCircle, XCircle, Clock, Zap } from 'lucide-react';

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
      case 'ready': return <Zap className="w-5 h-5 text-green-500" />;
      case 'checking': return <Clock className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'error': return <WifiOff className="w-5 h-5 text-red-500" />;
    }
  };

  const getResultIcon = (result: TestResult) => {
    switch (result.status) {
      case 'checking': return <Clock className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'ok': return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'bad': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'warning': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case 'failed': return <AlertTriangle className="w-4 h-4 text-gray-500" />;
    }
  };

  const getResultColor = (result: TestResult) => {
    switch (result.status) {
      case 'ok': return 'text-green-600 font-medium';
      case 'bad': return 'text-red-600 font-medium';
      case 'warning': return 'text-yellow-600 font-medium';
      case 'failed': return 'text-gray-600 font-medium';
      default: return 'text-blue-600';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 p-4 md:p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
                RU :: TCP 16-20 DPI Checker
              </h1>
              <p className="text-gray-600 text-sm md:text-base">
                Детекция DPI обрыва соединений методом TCP 16-20
              </p>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                {getStatusIcon()}
                <span className={`font-semibold text-sm md:text-base ${
                  status === 'ready' ? 'text-green-600' : 
                  status === 'checking' ? 'text-blue-600' : 'text-red-600'
                }`}>
                  Status: {statusText}
                </span>
              </div>
              
              <button
                onClick={isRunning ? handleStop : handleStart}
                disabled={status === 'checking'}
                className={`
                  flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all
                  ${isRunning || status === 'checking'
                    ? 'bg-gray-500 hover:bg-gray-600 text-white cursor-not-allowed'
                    : 'bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
                  }
                `}
              >
                {isRunning || status === 'checking' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span className="hidden sm:inline">
                  {isRunning || status === 'checking' ? 'Running...' : 'Start Test'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Results Table */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-blue-500 to-blue-600 text-white">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-sm md:text-base">#</th>
                  <th className="px-4 py-3 text-left font-semibold text-sm md:text-base">Provider</th>
                  <th className="px-4 py-3 text-left font-semibold text-sm md:text-base">DPI[tcp 16-20] Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {results.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-gray-500">
                      Нажмите "Start Test" для начала проверки
                    </td>
                  </tr>
                ) : (
                  results.map((result) => (
                    <tr key={result.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-sm md:text-base">{result.id}</td>
                      <td className="px-4 py-3 text-sm md:text-base">{result.provider}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {getResultIcon(result)}
                          <span className={`text-sm md:text-base ${getResultColor(result)}`}>
                            {result.statusText}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Logs */}
        <div className="bg-white rounded-xl shadow-lg overflow-hidden mb-6">
          <div className="bg-gray-800 px-4 py-2">
            <h3 className="text-white font-medium text-sm md:text-base">Console Logs</h3>
          </div>
          <div 
            ref={logRef}
            className="bg-gray-900 text-green-400 p-4 h-64 md:h-80 overflow-y-auto font-mono text-xs md:text-sm"
          >
            {logs.length === 0 ? (
              <div className="text-gray-500">Логи появятся здесь после запуска теста...</div>
            ) : (
              logs.map((log, index) => (
                <div key={index} className="mb-1 whitespace-pre-wrap break-words">
                  <span className="text-gray-400">[{log.timestamp}]</span>
                  {log.prefix && <span className="text-blue-400"> {log.prefix}/</span>}
                  <span className={`
                    ${log.level === 'ERR' ? 'text-red-400' : 
                      log.level === 'WARN' ? 'text-yellow-400' : 'text-green-400'}
                  `}> {log.level}</span>
                  <span className="text-gray-300">: {log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="bg-white rounded-xl shadow-lg p-6">
          <div className="text-center space-y-2">
            <p className="text-gray-600 text-sm md:text-base">
              💡 DPI[tcp 16-20] / См. <strong>
                <a 
                  href="https://github.com/net4people/bbs/issues/490" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 transition-colors"
                >
                  здесь
                </a>
              </strong> для получения дополнительной информации.
            </p>
            <p className="text-gray-600 text-sm md:text-base">
              Этот чекер (и другие) доступны в <strong>
                <a 
                  href="https://github.com/hyperion-cs/dpi-checkers" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-800 transition-colors"
                >
                  этом
                </a>
              </strong> открытом репозитории.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DPIChecker;