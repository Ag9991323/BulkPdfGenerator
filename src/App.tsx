import React, { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { saveAs } from 'file-saver';

// ─── Constants ─────────────────────────────────────────────────────────────
// Individual card size (mm)
const CARD_W = 75;
const CARD_H = 55;

// QR/Barcode overlay positions (measured from template IMG-20260522-WA0001.jpg)
const QR_X = 21; // mm from card left
const QR_Y = 18; // mm from card top
const QR_SZ = 12; // mm — square

const BC_X = 34; // mm from card left
const BC_Y = 17.5; // mm from card top
const BC_W = 20; // mm
const BC_H = 12.5; // mm

// ─── Helpers ───────────────────────────────────────────────────────────────

function resizeImage(
  file: File,
  maxW = 3000,
  maxH = 2100,
  quality = 0.92,
  cornerRadiusMM = 0
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const w = Math.round(img.naturalWidth * scale);
      const h = Math.round(img.naturalHeight * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext('2d');
      if (ctx && cornerRadiusMM > 0) {
        const r = Math.round((cornerRadiusMM / CARD_W) * w);
        ctx.beginPath();
        (ctx as any).roundRect(0, 0, w, h, r);
        ctx.clip();
      }

      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
      }

      resolve(canvas.toDataURL('image/png'));
      URL.revokeObjectURL(url);
    };

    img.onerror = reject;
    img.src = url;
  });
}

// ─── UI Components ─────────────────────────────────────────────────────────

const cardStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 14,
  padding: '22px 26px',
};

function Section({ title, badge, children }: any) {
  return (
    <div style={cardStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 18,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>
          {title}
        </h2>
        {badge && (
          <span
            style={{
              background: '#dbeafe',
              color: '#1d4ed8',
              fontSize: 12,
              fontWeight: 600,
              padding: '2px 10px',
              borderRadius: 20,
            }}
          >
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function DropZone({ accept, label, sublabel, onChange, active }: any) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  return (
    <div
      onClick={() => ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onChange({ target: { files: [f] } });
      }}
      style={{
        border: `2px dashed ${
          drag ? '#3b82f6' : active ? '#22c55e' : '#cbd5e1'
        }`,
        borderRadius: 10,
        padding: '28px 16px',
        textAlign: 'center',
        cursor: 'pointer',
        background: drag ? '#eff6ff' : active ? '#f0fdf4' : '#f8fafc',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 8 }}>
        {active ? '✓' : '📄'}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: active ? '#16a34a' : '#475569',
        }}
      >
        {label}
      </div>
      {sublabel && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
          {sublabel}
        </div>
      )}
      <input
        ref={ref}
        type="file"
        accept={accept}
        onChange={onChange}
        style={{ display: 'none' }}
      />
    </div>
  );
}

// ─── Range / Series Generator ──────────────────────────────────────────────

function RangeGenerator() {
  const [startNum, setStartNum] = useState('');
  const [endNum, setEndNum] = useState('');

  const buildRows = (start: number, end: number, gap: number) => {
    const rows: number[][] = [];
    let a = start;
    while (a <= end) {
      rows.push([a, Math.min(a + gap - 1, end)]);
      a += gap;
    }
    return rows;
  };

  const toCSV = (rows: number[][]) =>
    ['Start,End', ...rows.map((r) => r.join(','))].join('\n');

  const handleGenerate = () => {
    const start = parseInt(startNum, 10);
    const end = parseInt(endNum, 10);

    if (isNaN(start) || isNaN(end) || start > end) {
      alert('Enter a valid start and end number (start ≤ end).');
      return;
    }

    saveAs(
      new Blob([toCSV(buildRows(start, end, 30))], { type: 'text/csv' }),
      `series_gap30_${start}-${end}.csv`
    );
    saveAs(
      new Blob([toCSV(buildRows(start, end, 180))], { type: 'text/csv' }),
      `series_gap180_${start}-${end}.csv`
    );
  };

  const ready = startNum !== '' && endNum !== '';
  const inputStyle = {
    width: '100%',
    boxSizing: 'border-box' as const,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
    outline: 'none',
  };

  return (
    <div style={cardStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 18,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>
          Series Range Generator
        </h2>
        <span
          style={{
            background: '#f3e8ff',
            color: '#7c3aed',
            fontSize: 12,
            fontWeight: 600,
            padding: '2px 10px',
            borderRadius: 20,
          }}
        >
          Gap 30 &amp; 180
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div>
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#475569',
              display: 'block',
              marginBottom: 6,
            }}
          >
            Starting Number
          </label>
          <input
            type="number"
            min="0"
            value={startNum}
            onChange={(e) => setStartNum(e.target.value)}
            placeholder="e.g. 1"
            style={inputStyle}
          />
        </div>
        <div>
          <label
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: '#475569',
              display: 'block',
              marginBottom: 6,
            }}
          >
            Ending Number
          </label>
          <input
            type="number"
            min="0"
            value={endNum}
            onChange={(e) => setEndNum(e.target.value)}
            placeholder="e.g. 500"
            style={inputStyle}
          />
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={!ready}
        style={{
          width: '100%',
          border: 'none',
          borderRadius: 10,
          padding: '13px 24px',
          fontSize: 15,
          fontWeight: 700,
          cursor: ready ? 'pointer' : 'not-allowed',
          background: ready ? '#7c3aed' : '#94a3b8',
          color: 'white',
        }}
      >
        Download 2 CSV Files
      </button>

      <p
        style={{
          fontSize: 12,
          color: '#94a3b8',
          marginTop: 10,
          textAlign: 'center',
        }}
      >
        File 1 — rows: [A, A+30] stepping start → end &nbsp;·&nbsp; File 2 —
        rows: [A, A+180]
      </p>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────

export default function App() {
  const [pairCount, setPairCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [bgDataURL, setBgDataURL] = useState<string | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [excelName, setExcelName] = useState('all_cards');

  const abortRef = useRef(false);
  const xlsxZipRef = useRef<any>(null);
  const pairPathsRef = useRef<any[]>([]);

  // ── Excel upload ────────────────────────────────────────────────────────
  const onExcelFile = useCallback(async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;

    setPairCount(0);
    xlsxZipRef.current = null;
    pairPathsRef.current = [];
    setExcelName(file.name.replace(/\.[^.]+$/, ''));
    setProgress(null);
    setIsLoading(true);

    try {
      const zip = await JSZip.loadAsync(file);
      const relsText = await zip
        .file('xl/drawings/_rels/drawing1.xml.rels')
        ?.async('text');

      if (!relsText)
        throw new Error(
          'No drawing found — make sure this Excel has embedded QR/Barcode images.'
        );

      const ridToPath: Record<string, string> = {};
      for (const m of relsText.matchAll(
        /Id="(rId\d+)"[^>]*Target="([^"]+\.png)"/gi
      )) {
        ridToPath[m[1]] = m[2].replace(/^\.\.\//, 'xl/');
      }

      const drawingText = await zip
        .file('xl/drawings/drawing1.xml')
        ?.async('text');

      if (!drawingText) throw new Error('Could not read drawing XML.');

      const pairMap: Record<number, any> = {};
      for (const anchor of drawingText
        .split('<xdr:oneCellAnchor>')
        .slice(1)) {
        const nm = anchor.match(/name="(QRCode|Barcode)-(\d+)"/i);
        const rid = anchor.match(/r:embed="(rId\d+)"/);

        if (!nm || !rid) continue;

        const n = parseInt(nm[2]);
        if (!pairMap[n]) pairMap[n] = {};

        if (nm[1].toLowerCase() === 'qrcode')
          pairMap[n].qrRid = rid[1];
        else pairMap[n].bcRid = rid[1];
      }

      const sorted = Object.keys(pairMap)
        .map(Number)
        .sort((a, b) => a - b);

      if (!sorted.length)
        throw new Error(
          'No QRCode/Barcode pairs found (expected "QRCode-1", "Barcode-1", …).'
        );

      pairPathsRef.current = sorted.map((n) => ({
        qrPath: pairMap[n].qrRid ? (ridToPath[pairMap[n].qrRid] ?? null) : null,
        bcPath: pairMap[n].bcRid ? (ridToPath[pairMap[n].bcRid] ?? null) : null,
      }));

      xlsxZipRef.current = zip;
      setPairCount(sorted.length);
    } catch (err: any) {
      alert('Failed to read file: ' + err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Background upload ───────────────────────────────────────────────────
  const onBg = useCallback(async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const dataURL = await resizeImage(file, 3000, 2100, 0.92, 5);
      setBgDataURL(dataURL);
    } catch {
      alert('Could not load background image.');
    }
  }, []);

  // ── Generate ────────────────────────────────────────────────────────────
  const generate = async () => {
    if (!pairCount) return alert('Upload an Excel file first.');

    abortRef.current = false;
    setIsRunning(true);

    const total = pairCount;
    const sourceZip = xlsxZipRef.current;
    const pairPaths = pairPathsRef.current;

    setProgress({ current: 0, total, msg: 'Starting…', eta: null });

    // Sheet: 330.2 × 482.6 mm portrait | Print area: 308.18 × 463.1 mm
    // Cards: 75 × 55 mm — 4 cols × 8 rows = 32 per page, gaps distributed evenly
    const PAGE_W = 330.2;
    const PAGE_H = 482.6;
    const PRINT_W = 308.18;
    const PRINT_H = 463.1;
    const COLS = Math.floor(PRINT_W / CARD_W); // 4
    const ROWS = Math.floor(PRINT_H / CARD_H); // 8
    const PER_PAGE = COLS * ROWS; // 32
    const GAP_X = (PRINT_W - COLS * CARD_W) / (COLS - 1); // ~2.73 mm
    const GAP_Y = (PRINT_H - ROWS * CARD_H) / (ROWS - 1); // ~3.3 mm
    const OX = (PAGE_W - PRINT_W) / 2; // ~11 mm
    const OY = (PAGE_H - PRINT_H) / 2; // ~9.75 mm

    const pdf = new jsPDF({
      unit: 'mm',
      format: [PAGE_W, PAGE_H],
      orientation: 'portrait',
    });

    const t0 = Date.now();

    for (let i = 0; i < total; i++) {
      if (abortRef.current) break;

      const slot = i % PER_PAGE;
      if (i > 0 && slot === 0) pdf.addPage([PAGE_W, PAGE_H], 'portrait');

      const col = Math.floor(slot / ROWS);
      const row = slot % ROWS;
      const cardX = OX + col * (CARD_W + GAP_X);
      const cardY = OY + row * (CARD_H + GAP_Y);

      try {
        // Draw background — alias 'bg' lets jsPDF reuse encoded data for every card
        if (bgDataURL)
          pdf.addImage(
            bgDataURL,
            'PNG',
            cardX,
            cardY,
            CARD_W,
            CARD_H,
            'bg',
            'FAST'
          );

        const { qrPath, bcPath } = pairPaths[i];
        const [qrB64, bcB64] = await Promise.all([
          qrPath
            ? sourceZip.file(qrPath)?.async('base64')
            : Promise.resolve(null),
          bcPath
            ? sourceZip.file(bcPath)?.async('base64')
            : Promise.resolve(null),
        ]);

        // Overlay QR and barcode at hardcoded positions (measured from template)
        if (qrB64)
          pdf.addImage(
            `data:image/png;base64,${qrB64}`,
            'PNG',
            cardX + QR_X,
            cardY + QR_Y,
            QR_SZ,
            QR_SZ,
            undefined,
            'FAST'
          );

        if (bcB64)
          pdf.addImage(
            `data:image/png;base64,${bcB64}`,
            'PNG',
            cardX + BC_X,
            cardY + BC_Y,
            BC_W,
            BC_H,
            undefined,
            'FAST'
          );
      } catch (err) {
        console.error(`Pair ${i + 1} failed:`, err);
      }

      if (i % 10 === 9 || i === total - 1) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = (i + 1) / elapsed;
        const eta = Math.ceil((total - i - 1) / Math.max(rate, 0.01));

        setProgress({
          current: i + 1,
          total,
          msg: `Processing ${i + 1} / ${total}`,
          eta:
            eta > 0
              ? `~${eta < 60 ? eta + 's' : Math.ceil(eta / 60) + 'm'} remaining`
              : null,
        });

        await new Promise((r) => setTimeout(r, 0));
      }
    }

    if (abortRef.current) {
      setProgress(null);
      setIsRunning(false);
      return;
    }

    setProgress({ current: total, total, msg: 'Saving PDF…', eta: null });
    const blob = pdf.output('blob');
    saveAs(blob, `${excelName}.pdf`);

    setProgress({
      current: total,
      total,
      msg: `Done! ${total} cards saved to ${excelName}.pdf`,
      eta: null,
      done: true,
    });

    setIsRunning(false);
  };

  const cancel = () => {
    abortRef.current = true;
  };

  const pct = progress
    ? Math.round((progress.current / progress.total) * 100)
    : 0;

  return (
    <div
      style={{
        fontFamily: "'Inter', system-ui, sans-serif",
        minHeight: '100vh',
        background: '#f0f4f8',
        padding: '36px 20px',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a' }}>
            Bulk PDF Generator
          </h1>
          <p style={{ fontSize: 14, color: '#64748b', marginTop: 6 }}>
            Excel (QR &amp; barcode images) + background template → one PDF, 32
            cards per 330.2 × 482.6 mm sheet (75 × 55 mm each, 4 cols × 8
            rows).
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 20,
            marginBottom: 20,
          }}
        >
          <Section
            title="1 · Excel File"
            badge={
              pairCount
                ? `${pairCount.toLocaleString()} pairs`
                : isLoading
                  ? 'Reading…'
                  : null
            }
          >
            <DropZone
              accept=".xlsx,.xls,.xlsm"
              label={
                isLoading
                  ? 'Reading…'
                  : pairCount
                    ? `${pairCount.toLocaleString()} pairs found ✓`
                    : 'Drop Excel file here or click'
              }
              sublabel="Excel with QRCode-N / Barcode-N embedded images"
              onChange={onExcelFile}
              active={pairCount > 0}
            />
          </Section>

          <Section
            title="2 · Background Template"
            badge={bgDataURL ? 'Loaded ✓' : null}
          >
            <DropZone
              accept="image/*"
              label={
                bgDataURL
                  ? 'Background loaded ✓'
                  : 'Drop background image here or click'
              }
              sublabel="Agricultural card template (fixed positions hardcoded)"
              onChange={onBg}
              active={!!bgDataURL}
            />
          </Section>
        </div>

        <div style={cardStyle}>
          {pairCount > 1000 && !progress && (
            <div
              style={{
                background: '#fef3c7',
                border: '1px solid #fbbf24',
                borderRadius: 8,
                padding: '10px 14px',
                marginBottom: 16,
                fontSize: 13,
                color: '#92400e',
              }}
            >
              <strong>Note:</strong> {pairCount.toLocaleString()} cards across{' '}
              {Math.ceil(pairCount / 32).toLocaleString()} pages will take
              several minutes.
            </div>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={generate}
              disabled={isRunning || !pairCount}
              style={{
                flex: 1,
                border: 'none',
                borderRadius: 10,
                padding: '15px 24px',
                fontSize: 16,
                fontWeight: 700,
                cursor: isRunning || !pairCount ? 'not-allowed' : 'pointer',
                background: isRunning || !pairCount ? '#94a3b8' : '#2563eb',
                color: 'white',
              }}
            >
              {isRunning
                ? 'Generating PDF…'
                : pairCount
                  ? `Generate PDF (${pairCount.toLocaleString()} cards, ${Math.ceil(pairCount / 32)} pages) & Download`
                  : 'Upload an Excel file to begin'}
            </button>

            {isRunning && (
              <button
                onClick={cancel}
                style={{
                  background: '#ef4444',
                  color: 'white',
                  border: 'none',
                  borderRadius: 10,
                  padding: '15px 20px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            )}
          </div>

          {progress && (
            <div style={{ marginTop: 18 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: progress.done ? '#16a34a' : '#475569',
                  }}
                >
                  {progress.msg}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    color: '#64748b',
                    display: 'flex',
                    gap: 12,
                  }}
                >
                  {progress.eta && <span>{progress.eta}</span>}
                  <span style={{ fontWeight: 700 }}>{pct}%</span>
                </span>
              </div>

              <div
                style={{
                  background: '#e2e8f0',
                  borderRadius: 999,
                  height: 10,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    background: progress.done ? '#22c55e' : '#3b82f6',
                    height: '100%',
                    width: `${pct}%`,
                    borderRadius: 999,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>

              {progress.done && (
                <p
                  style={{
                    marginTop: 10,
                    fontSize: 13,
                    color: '#16a34a',
                    fontWeight: 600,
                    textAlign: 'center',
                  }}
                >
                  {excelName}.pdf saved to your downloads folder.
                </p>
              )}
            </div>
          )}
        </div>

        <p
          style={{
            textAlign: 'center',
            fontSize: 12,
            color: '#94a3b8',
            marginTop: 24,
          }}
        >
          All processing happens in your browser — no data leaves your device.
        </p>

        <hr
          style={{
            border: 'none',
            borderTop: '1px solid #e2e8f0',
            margin: '32px 0',
          }}
        />

        <div style={{ marginBottom: 20 }}>
          <h2
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: '#0f172a',
            }}
          >
            Series Range Generator
          </h2>
          <p style={{ fontSize: 14, color: '#64748b', marginTop: 4 }}>
            Enter a number range to download two CSV files — one chunked every
            30, one every 180.
          </p>
        </div>

        <RangeGenerator />
      </div>
    </div>
  );
}