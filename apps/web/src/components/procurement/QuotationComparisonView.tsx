import React, { useState } from 'react';

export interface ComparisonQuoteLine {
  supplierId: string;
  supplierName: string;
  quotationNumber: string;
  unitPrice: string;
  quotedQuantity: string;
  lineTotal: string;
  leadTimeDays: number;
  paymentTerms: string;
  isAwarded?: boolean;
}

interface QuotationComparisonViewProps {
  rfqNumber: string;
  rfqTitle: string;
  comparisonItems: {
    rfqLineId: string;
    description: string;
    requestedQuantity: string;
    uom: string;
    quotes: ComparisonQuoteLine[];
  }[];
  onBack: () => void;
  onAward: (awardedSupplierId: string, lineSelections: { rfqLineId: string; supplierQuotationLineId: string; awardQuantity: string }[]) => Promise<void>;
}

export const QuotationComparisonView: React.FC<QuotationComparisonViewProps> = ({
  rfqNumber,
  rfqTitle,
  comparisonItems,
  onBack,
  onAward
}) => {
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [isAwarding, setIsAwarding] = useState(false);

  const handleConfirmAward = async () => {
    if (!selectedSupplierId) return;
    setIsAwarding(true);
    try {
      await onAward(selectedSupplierId, []);
    } finally {
      setIsAwarding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <button onClick={onBack} className="text-xs font-semibold text-indigo-400 hover:underline mb-1">
            ← Back to RFQ List
          </button>
          <h2 className="text-xl font-black text-white flex items-center gap-3">
            Quotation Comparison Matrix
            <span className="font-mono text-xs bg-purple-950 text-purple-400 border border-purple-800 px-2 py-0.5 rounded">
              {rfqNumber}
            </span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">{rfqTitle}</p>
        </div>

        <button
          onClick={handleConfirmAward}
          disabled={!selectedSupplierId || isAwarding}
          className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/20"
        >
          {isAwarding ? 'Awarding...' : 'Award Supplier & Generate PO Draft'}
        </button>
      </div>

      {comparisonItems.map((item, idx) => (
        <div key={idx} className="bg-slate-900/60 backdrop-blur border border-slate-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Item #{idx + 1}</span>
              <h3 className="text-sm font-bold text-white">{item.description}</h3>
              <p className="text-xs text-slate-400">Requested: {item.requestedQuantity} {item.uom}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {item.quotes.map((q, qIdx) => (
              <div
                key={qIdx}
                onClick={() => setSelectedSupplierId(q.supplierId)}
                className={`p-4 rounded-xl border cursor-pointer transition-all ${
                  selectedSupplierId === q.supplierId
                    ? 'bg-indigo-950/40 border-indigo-500 ring-2 ring-indigo-500/20'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                  <span className="font-bold text-xs text-white">{q.supplierName}</span>
                  <span className="text-[10px] font-mono text-slate-400">{q.quotationNumber}</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Unit Price:</span>
                    <span className="font-mono font-semibold text-white">₹{q.unitPrice}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Line Total:</span>
                    <span className="font-mono font-bold text-emerald-400">₹{q.lineTotal}</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Lead Time:</span>
                    <span className="text-slate-200">{q.leadTimeDays} Days</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">Terms:</span>
                    <span className="text-slate-200">{q.paymentTerms}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
