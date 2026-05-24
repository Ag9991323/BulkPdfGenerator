import React, { useState, useRef, useCallback } from 'react';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';
import { saveAs } from 'file-saver';

// ─── constants ─────────────────────────────────────────────────────────────
// Card size (mm) — landscape
const CARD_W = 75;
const CARD_H = 55;

// Positions from actual template image (IMG-20260522-WA0001.jpg, 1279×827 px → 75×55 mm).
// Scale: x = 75/1279 mm/px, y = 55/827 mm/px
// White panel: X 17–55 mm, Y 19–34 mm (height 15 mm)
// QR zone: X 17–27 mm (10 mm wide — template QR is square in px but maps to 10×15 mm due to
// aspect-ratio stretch; QR overlay must stay square for scanability → 12 mm fits neatly)
// Barcode zone: X 30–55 mm (25 mm wide), same Y range as QR
const QR_X = 21; // mm from card left
const QR_Y = 18; // mm from card top
const QR_SZ = 12; // mm — square (slightly less than 13 per user feedback; same height as BC_H)

const BC_X = 34; // mm from card left (QR ends at 29 → 1 mm gap)
const BC_Y = 18.5; // mm from card top (same top edge as QR)
const BC_W = 20; // mm (30+25=55 mm, fits to panel right edge)
const BC_H = 11.5; // mm (= QR_SZ so both span the same height tile)

// ─── helpers ───────────────────────────────────────────────────────────────
function resizeImage(file: File, maxW = 1600, maxH = 1200, quality = 0.92) {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality));
      URL.revokeObjectURL(url);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ─── UI components ────────────────────────────────────────────────────────
const cardStyle = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 14,
  padding: '22px 26px',
};

interface SectionProps {
  title: string;
  badge?: string | null;
  children: React.ReactNode;
}

function Section({ title, badge, children }: SectionProps) {
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
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

interface DropZoneProps {
  accept: string;
  label: string;
  sublabel?: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  active: boolean;
}

function DropZone({ accept, label, sublabel, onChange, active }: DropZoneProps) {
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
        if (f) onChange({ target: { files: [f] } } as any);
      }}
      style={{
        border: `2px dashed ${drag ? '#3b82f6' : active ? '#22c55e' : '#cbd5e1'}`,
        borderRadius: 10,
        padding: '28px 16px',
        textAlign: 'center',
        cursor: 'pointer',
        background: drag ? '#eff6ff' : active ? '#f0fdf4' : '#f8fafc',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ fontSize: 32, marginBottom: 8 }}>
        {active ? '✓' : '📎'}
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, color: active ? '#16a34a' : '#475569' }}>
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

// ─── App ───────────────────────────────────────────────────────────────────
interface PairPath {
  qrPath: string | null;
  bcPath: string | null;
}

interface Progress {
  current: number;
  total: number;
  msg: string;
  eta: string | null;
  done?: boolean;
}

export default function App() {
  const [pairCount, setPairCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [bgDataURL, setBgDataURL] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [excelName, setExcelName] = useState('all_cards');

  const abortRef = useRef(false);
  const xlsxZipRef = useRef<JSZip | null>(null);
  const pairPathsRef = useRef<PairPath[]>([]);

  // ── Excel upload ──────────────────────────────────────────────────────
  const onExcelFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setPairCount(0);
      xlsxZipRef.current = null;
      pairPathsRef.current = [];
      setExcelName(file.name.replace(/\.[^.]+$/, ''));
      setProgress(null);
      setIsLoading(true);

      try {
        const zip = await JSZip.loadAsync(file);

        const relsText = await zip.file('xl/drawings/_rels/drawing1.xml.rels')?.async('text');
        if (!relsText)
          throw new Error('No drawing found — make sure this Excel has embedded QR/Barcode images.');

        const ridToPath: Record<string, string> = {};
        for (const m of relsText.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+\.png)"/gi)) {
          ridToPath[m[1]] = m[2].replace(/^\.\.\//, 'xl/');
        }

        const drawingText = await zip.file('xl/drawings/drawing1.xml')?.async('text');
        if (!drawingText) throw new Error('Could not read drawing XML.');

        const pairMap: Record<number, any> = {};
        for (const anchor of drawingText.split('<xdr:oneCellAnchor>').slice(1)) {
          const nm = anchor.match(/name="(QRCode|Barcode)-(\d+)"/i);
          const rid = anchor.match(/r:embed="(rId\d+)"/);
          if (!nm || !rid) continue;

          const n = parseInt(nm[2]);
          if (!pairMap[n]) pairMap[n] = {};
          if (nm[1].toLowerCase() === 'qrcode') pairMap[n].qrRid = rid[1];
          else pairMap[n].bcRid = rid[1];
        }

        const sorted = Object.keys(pairMap)
          .map(Number)
          .sort((a, b) => a - b);
        if (!sorted.length)
          throw new Error('No QRCode/Barcode pairs found (expected "QRCode-1", "Barcode-1", …).');

        pairPathsRef.current = sorted.map((n) => ({
          qrPath: pairMap[n].qrRid ? ridToPath[pairMap[n].qrRid] ?? null : null,
          bcPath: pairMap[n].bcRid ? ridToPath[pairMap[n].bcRid] ?? null : null,
        }));

        xlsxZipRef.current = zip;
        setPairCount(sorted.length);
      } catch (err) {
        alert('Failed to read file: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // ── Background upload ─────────────────────────────────────────────────
  const onBg = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const dataURL = await resizeImage(file);
        setBgDataURL(dataURL);
      } catch {
        alert('Could not load background image.');
      }
    },
    []
  );

  // ── Generate ──────────────────────────────────────────────────────────
  const generate = async () => {
    if (!pairCount) return alert('Upload an Excel file first.');

    abortRef.current = false;
    setIsRunning(true);
    const total = pairCount;
    const sourceZip = xlsxZipRef.current;
    const pairPaths = pairPathsRef.current;
    setProgress({ current: 0, total, msg: 'Starting…', eta: null });

    // A4 portrait — 2 cols × 5 rows = 10 cards per page
    const PAGE_W = 210;
    const PAGE_H = 297;
    const GAP = 2;
    const COLS = Math.floor((PAGE_W + GAP) / (CARD_W + GAP)); // 2
    const ROWS = Math.floor((PAGE_H + GAP) / (CARD_H + GAP)); // 5
    const PER_PAGE = COLS * ROWS; // 10
    const OX = (PAGE_W - (COLS * CARD_W + (COLS - 1) * GAP)) / 2;
    const OY = (PAGE_H - (ROWS * CARD_H + (ROWS - 1) * GAP)) / 2;

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

      const col = slot % COLS;
      const row = Math.floor(slot / COLS);
      const cardX = OX + col * (CARD_W + GAP);
      const cardY = OY + row * (CARD_H + GAP);

      try {
        // Draw background — alias 'bg' lets jsPDF reuse encoded data for every card
        if (bgDataURL) pdf.addImage(bgDataURL, 'JPEG', cardX, cardY, CARD_W, CARD_H, 'bg', 'FAST');

        const { qrPath, bcPath } = pairPaths[i];
        const [qrB64, bcB64] = await Promise.all([
          qrPath ? sourceZip?.file(qrPath)?.async('base64') : Promise.resolve(null),
          bcPath ? sourceZip?.file(bcPath)?.async('base64') : Promise.resolve(null),
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
          eta: eta > 0 ? `~${eta < 60 ? eta + 's' : Math.ceil(eta / 60) + 'm'} remaining` : null,
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

  const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0;

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
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: '#0f172a' }}>
            Bulk PDF Generator
          </h1>
          <p style={{ fontSize: 14, color: '#64748b', marginTop: 6 }}>
            Excel (QR &amp; barcode images) + background template → one PDF, 10 cards per A4 page
            (75 × 55 mm each).
          </p>
        </div>

        {/* Upload Sections */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
          <Section
            title="1 · Excel File"
            badge={
              pairCount ? `${pairCount.toLocaleString()} pairs` : isLoading ? 'Reading…' : null
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

          <Section title="2 · Background Template" badge={bgDataURL ? 'Loaded ✓' : null}>
            <DropZone
              accept="image/*"
              label={
                bgDataURL ? 'Background loaded ✓' : 'Drop background image here or click'
              }
              sublabel="Agricultural card template (fixed positions hardcoded)"
              onChange={onBg}
              active={!!bgDataURL}
            />
          </Section>
        </div>

        {/* Generate Section */}
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
              {Math.ceil(pairCount / 10).toLocaleString()} A4 pages will take several minutes.
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
                  ? `Generate PDF (${pairCount.toLocaleString()} cards, ${Math.ceil(pairCount / 10)} pages) & Download`
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
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: progress.done ? '#16a34a' : '#475569',
                  }}
                >
                  {progress.msg}
                </span>
                <span style={{ fontSize: 13, color: '#64748b', display: 'flex', gap: 12 }}>
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

        {/* Footer */}
        <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 24 }}>
          All processing happens in your browser — no data leaves your device.
        </p>
      </div>
    </div>
  );
}