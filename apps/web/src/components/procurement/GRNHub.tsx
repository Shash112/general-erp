import React, { useState } from 'react';
import { GRNListTable, GoodsReceiptListItem } from './GRNListTable';
import { GRNFormModal, PurchaseOrderOption, PoReceivableLine } from './GRNFormModal';
import { GRNInspectionModal, InspectionLineItem } from './GRNInspectionModal';
import { GRNDetailsView, GoodsReceiptDetailData } from './GRNDetailsView';

interface GRNHubProps {
  receipts: GoodsReceiptListItem[];
  purchaseOrders: PurchaseOrderOption[];
  onFetchReceiptDetails: (id: string) => Promise<GoodsReceiptDetailData>;
  onFetchPoReceivableLines: (poId: string) => Promise<PoReceivableLine[]>;
  onCreateReceipt: (data: any) => Promise<void>;
  onInspectReceipt: (grnId: string, lines: any[]) => Promise<void>;
  onAcceptReceipt: (grnId: string) => Promise<void>;
  onRejectReceipt: (grnId: string, reason?: string) => Promise<void>;
  onCancelReceipt: (grnId: string, reason?: string) => Promise<void>;
}

export const GRNHub: React.FC<GRNHubProps> = ({
  receipts,
  purchaseOrders,
  onFetchReceiptDetails,
  onFetchPoReceivableLines,
  onCreateReceipt,
  onInspectReceipt,
  onAcceptReceipt,
  onRejectReceipt,
  onCancelReceipt,
}) => {
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [activeReceiptDetail, setActiveReceiptDetail] = useState<GoodsReceiptDetailData | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isInspectionOpen, setIsInspectionOpen] = useState(false);

  const [loadingDetail, setLoadingDetail] = useState(false);

  const handleSelectReceipt = async (id: string) => {
    setSelectedReceiptId(id);
    setLoadingDetail(true);
    try {
      const detail = await onFetchReceiptDetails(id);
      setActiveReceiptDetail(detail);
    } catch (err) {
      console.error('Failed to fetch GRN details:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleBackToList = () => {
    setSelectedReceiptId(null);
    setActiveReceiptDetail(null);
  };

  const handleRefreshDetail = async () => {
    if (selectedReceiptId) {
      const detail = await onFetchReceiptDetails(selectedReceiptId);
      setActiveReceiptDetail(detail);
    }
  };

  return (
    <div className="p-6 space-y-6 bg-slate-950 min-h-screen text-slate-100">
      {selectedReceiptId && activeReceiptDetail ? (
        loadingDetail ? (
          <div className="py-12 text-center text-xs text-slate-400">Loading GRN details...</div>
        ) : (
          <GRNDetailsView
            receipt={activeReceiptDetail}
            onBack={handleBackToList}
            onInspect={() => setIsInspectionOpen(true)}
            onAccept={async () => {
              await onAcceptReceipt(selectedReceiptId);
              await handleRefreshDetail();
            }}
            onReject={async (reason) => {
              await onRejectReceipt(selectedReceiptId, reason);
              await handleRefreshDetail();
            }}
            onCancel={async (reason) => {
              await onCancelReceipt(selectedReceiptId, reason);
              await handleRefreshDetail();
            }}
          />
        )
      ) : (
        <GRNListTable
          receipts={receipts}
          onSelectReceipt={handleSelectReceipt}
          onNewReceipt={() => setIsFormOpen(true)}
        />
      )}

      {/* Form Modal */}
      <GRNFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        purchaseOrders={purchaseOrders}
        onFetchReceivableLines={onFetchPoReceivableLines}
        onSubmit={onCreateReceipt}
      />

      {/* Quality Inspection Modal */}
      {activeReceiptDetail && (
        <GRNInspectionModal
          isOpen={isInspectionOpen}
          onClose={() => setIsInspectionOpen(false)}
          grnNumber={activeReceiptDetail.grnNumber}
          lines={activeReceiptDetail.lines.map((l) => ({
            lineId: l.id,
            lineNumber: l.lineNumber,
            descriptionSnapshot: l.descriptionSnapshot,
            receivedQuantity: l.receivedQuantity,
            acceptedQuantity: l.acceptedQuantity,
            rejectedQuantity: l.rejectedQuantity,
            rejectionReason: l.rejectionReason,
          }))}
          onSubmitInspection={async (inspectLines) => {
            if (selectedReceiptId) {
              await onInspectReceipt(selectedReceiptId, inspectLines);
              await handleRefreshDetail();
            }
          }}
        />
      )}
    </div>
  );
};
