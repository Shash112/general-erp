import React, { useState } from 'react';

export interface MatchLineComparison {
  lineNumber: number;
  description: string;
  uom: string;
  poOrderedQty?: string;
  poUnitPrice?: string;
  grnAcceptedQty?: string;
  billedQty: string;
  billedUnitPrice: string;
  billedLineTotal: string;
  quantityVariance?: string;
  priceVariance?: string;
  hasQuantityException?: boolean;
  hasPriceException?: boolean;
}

export interface MatchExceptionItem {
  id: string;
  exceptionType: string;
  severity: string;
  expectedValue: string;
  actualValue: string;
  variance: string;
  configuredTolerance: string;
  reason: string;
  status: string;
}

interface ThreeWayMatchWorkspaceProps {
  billNumber: string;
  supplierInvoiceNumber: string;
  supplierName?: string;
  poNumber?: string;
  grnNumber?: string;
  matchStatus: string;
  lines: MatchLineComparison[];
  exceptions: MatchExceptionItem[];
  matchOverrideReason?: string | null;
  onRunMatch: (tolerances: { priceTol: number; qtyTol: number }) => Promise<void>;
  onOverrideMatch: (reason: string) => Promise<void>;
}

export const ThreeWayMatchWorkspace: React.FC<ThreeWayMatchWorkspaceProps> = ({
  billNumber,
  supplierInvoiceNumber,
  supplierName,
  poNumber,
  grnNumber,
  matchStatus,
  lines,
  exceptions,
  matchOverrideReason,
  onRunMatch,
  onOverrideMatch,
}) => {
  const [priceTolerancePercent, setPriceTolerancePercent] = useState<number>(0);
  const [qtyTolerancePercent, setQtyTolerancePercent] = useState<number>(0);
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [showOverrideModal, setShowOverrideModal] = useState<boolean>(false);
  const [running, setRunning] = useState<boolean>(false);
  const [overriding, setOverriding] = useState<boolean>(false);

  const handleRunMatch = async () => {
    setRunning(true);
    try {
      await onRunMatch({
        priceTol: priceTolerancePercent / 100.0,
        qtyTol: qtyTolerancePercent / 100.0,
      });
    } catch (err) {
      console.error('Match execution failed:', err);
    } finally {
      setRunning(false);
    }
  };

  const handleConfirmOverride = async () => {
    if (!overrideReason.trim()) return;
    setOverriding(true);
    try {
      await onOverrideMatch(overrideReason.trim());
      setShowOverrideModal(false);
      setOverrideReason('');
    } catch (err) {
      console.error('Match override failed:', err);
    } finally {
      setOverriding(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden p-6 space-y-6 text-slate-200">
      {/* Workspace Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-slate-100">Three-Way Match Workspace</h2>
            <span
              className={`px-2.5 py-0.5 text-xs font-bold rounded-full border ${
                matchStatus === 'MATCHED'
                  ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                  : matchStatus === 'RESOLVED'
                  ? 'bg-amber-950 text-amber-300 border-amber-800'
                  : matchStatus === 'EXCEPTION'
                  ? 'bg-rose-950 text-rose-400 border-rose-800'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {matchStatus}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Comparing Purchase Order ({poNumber || '—'}), GRN ({grnNumber || '—'}), and Supplier Bill ({billNumber} / Invoice: {supplierInvoiceNumber}).
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRunMatch}
            disabled={running}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow transition-colors"
          >
            {running ? 'Running Match...' : '⚡ Run 3-Way Match'}
          </button>
          {matchStatus === 'EXCEPTION' && (
            <button
              onClick={() => setShowOverrideModal(true)}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg shadow transition-colors"
            >
              Authorize Match Override
            </button>
          )}
        </div>
      </div>

      {/* Tolerance Config Bar */}
      <div className="p-4 bg-slate-950 border border-slate-800 rounded-lg grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div>
          <label className="block text-slate-400 mb-1 font-medium">Price Variance Tolerance (%): {priceTolerancePercent}%</label>
          <input
            type="range"
            min="0"
            max="10"
            step="0.5"
            value={priceTolerancePercent}
            onChange={(e) => setPriceTolerancePercent(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-1 font-medium">Quantity Variance Tolerance (%): {qtyTolerancePercent}%</label>
          <input
            type="range"
            min="0"
            max="10"
            step="0.5"
            value={qtyTolerancePercent}
            onChange={(e) => setQtyTolerancePercent(parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>
      </div>

      {/* Override Reason Box if Resolved */}
      {matchOverrideReason && (
        <div className="p-4 bg-amber-950/40 border border-amber-800/80 rounded-lg text-xs text-amber-200">
          <div className="font-semibold mb-1">⚡ Match Override Authorized</div>
          <div>Reason: {matchOverrideReason}</div>
        </div>
      )}

      {/* Line-Level Comparison Matrix Table */}
      <div>
        <h3 className="text-sm font-semibold text-slate-200 mb-3">Line-by-Line Match Comparison</h3>
        <div className="overflow-x-auto border border-slate-800 rounded-lg">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
              <tr>
                <th className="p-3">Line</th>
                <th className="p-3">Description</th>
                <th className="p-3 text-right">PO Qty</th>
                <th className="p-3 text-right">GRN Accepted Qty</th>
                <th className="p-3 text-right">Billed Qty</th>
                <th className="p-3 text-right">PO Price</th>
                <th className="p-3 text-right">Billed Price</th>
                <th className="p-3 text-right">Billed Total</th>
                <th className="p-3 text-center">Match Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono">
              {lines.map((l) => {
                const hasExc = l.hasQuantityException || l.hasPriceException;
                return (
                  <tr key={l.lineNumber} className={hasExc ? 'bg-rose-950/20' : 'hover:bg-slate-800/30'}>
                    <td className="p-3 font-semibold text-slate-400">{l.lineNumber}</td>
                    <td className="p-3 font-sans text-slate-200">{l.description}</td>
                    <td className="p-3 text-right text-slate-400">{l.poOrderedQty || '—'} {l.uom}</td>
                    <td className="p-3 text-right text-emerald-400 font-semibold">{l.grnAcceptedQty || '—'} {l.uom}</td>
                    <td className="p-3 text-right font-semibold text-slate-100">{l.billedQty} {l.uom}</td>
                    <td className="p-3 text-right text-slate-400">₹{l.poUnitPrice || '—'}</td>
                    <td className="p-3 text-right font-semibold text-slate-100">₹{l.billedUnitPrice}</td>
                    <td className="p-3 text-right font-semibold text-slate-100">₹{parseFloat(l.billedLineTotal).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    <td className="p-3 text-center font-sans">
                      {hasExc ? (
                        <span className="px-2 py-0.5 text-xs font-bold rounded bg-rose-950 text-rose-400 border border-rose-800">
                          MISMATCH
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs font-bold rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                          MATCHED
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Exception Detail Log */}
      {exceptions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-rose-300">Detected Match Exceptions ({exceptions.length})</h3>
          <div className="space-y-2">
            {exceptions.map((exc) => (
              <div key={exc.id} className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-lg text-xs space-y-1">
                <div className="flex items-center justify-between font-semibold text-rose-200">
                  <span>[{exc.exceptionType}] {exc.reason}</span>
                  <span className="px-2 py-0.5 text-xs rounded bg-rose-900 text-rose-300">{exc.severity}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-slate-400 mt-2">
                  <div>Expected: <span className="text-slate-200 font-mono">{exc.expectedValue}</span></div>
                  <div>Actual Billed: <span className="text-rose-300 font-mono">{exc.actualValue}</span></div>
                  <div>Variance: <span className="text-rose-400 font-mono">{exc.variance}</span></div>
                  <div>Tolerance: <span className="text-slate-200 font-mono">{exc.configuredTolerance}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Override Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-lg p-6 space-y-4 shadow-2xl text-slate-200">
            <h3 className="text-base font-semibold text-slate-100">Authorize Match Exception Override</h3>
            <p className="text-xs text-slate-400">
              Overriding match exceptions allows posting the Supplier Bill with commercial discrepancies. An audit log entry will be permanently recorded.
            </p>

            <div>
              <label className="block text-slate-300 mb-1 font-medium text-xs">Mandatory Override Reason *</label>
              <textarea
                required
                rows={3}
                placeholder="State explicit business justification for overriding price/quantity variance..."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded text-xs text-slate-200 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowOverrideModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmOverride}
                disabled={overriding || !overrideReason.trim()}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded shadow disabled:opacity-50"
              >
                {overriding ? 'Authorizing...' : 'Authorize Override & Approve'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
