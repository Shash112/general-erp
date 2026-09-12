import React, { useState } from 'react';
import { SupplierBillListTable, SupplierBillListItem } from './SupplierBillListTable';
import { SupplierBillFormModal, PurchaseOrderOption } from './SupplierBillFormModal';
import { ThreeWayMatchWorkspace, MatchLineComparison, MatchExceptionItem } from './ThreeWayMatchWorkspace';
import { SupplierBillDetailsView, SupplierBillDetailData } from './SupplierBillDetailsView';

interface SupplierBillHubProps {
  bills: SupplierBillListItem[];
  purchaseOrders: PurchaseOrderOption[];
  onFetchBillDetails: (id: string) => Promise<SupplierBillDetailData>;
  onCreateBill: (data: any) => Promise<void>;
  onRunMatch: (billId: string, tolerances: { priceTol: number; qtyTol: number }) => Promise<any>;
  onOverrideMatch: (billId: string, reason: string) => Promise<void>;
  onApproveBill: (billId: string) => Promise<void>;
  onPostBill: (billId: string) => Promise<void>;
  onCancelBill: (billId: string, reason: string) => Promise<void>;
}

export const SupplierBillHub: React.FC<SupplierBillHubProps> = ({
  bills,
  purchaseOrders,
  onFetchBillDetails,
  onCreateBill,
  onRunMatch,
  onOverrideMatch,
  onApproveBill,
  onPostBill,
  onCancelBill,
}) => {
  const [activeTab, setActiveTab] = useState<'BILLS' | 'MATCH' | 'EXCEPTIONS'>('BILLS');
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [activeBillDetail, setActiveBillDetail] = useState<SupplierBillDetailData | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const handleSelectBill = async (id: string) => {
    setSelectedBillId(id);
    setLoadingDetail(true);
    try {
      const detail = await onFetchBillDetails(id);
      setActiveBillDetail(detail);
    } catch (err) {
      console.error('Failed to fetch Supplier Bill details:', err);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleBackToList = () => {
    setSelectedBillId(null);
    setActiveBillDetail(null);
  };

  const handleRefreshDetail = async () => {
    if (selectedBillId) {
      const detail = await onFetchBillDetails(selectedBillId);
      setActiveBillDetail(detail);
    }
  };

  const exceptionsList = bills.filter((b) => b.matchStatus === 'EXCEPTION');

  return (
    <div className="p-6 space-y-6 bg-slate-950 min-h-screen text-slate-100">
      {/* Top Workbench Header & Navigation Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Procurement Supplier Billing & 3-Way Matching Workbench</h1>
          <p className="text-xs text-slate-400">
            Authoritative supplier billing flow connecting POs, accepted GRNs, 3-way match tolerances, and AP/GL postings.
          </p>
        </div>

        <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1 text-xs">
          <button
            onClick={() => {
              setActiveTab('BILLS');
              handleBackToList();
            }}
            className={`px-3 py-1.5 font-medium rounded-md transition-colors ${
              activeTab === 'BILLS' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Supplier Bills ({bills.length})
          </button>
          <button
            onClick={() => setActiveTab('EXCEPTIONS')}
            className={`px-3 py-1.5 font-medium rounded-md transition-colors ${
              activeTab === 'EXCEPTIONS' ? 'bg-rose-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Match Exceptions ({exceptionsList.length})
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {selectedBillId && activeBillDetail ? (
        loadingDetail ? (
          <div className="py-12 text-center text-xs text-slate-400">Loading Supplier Bill details...</div>
        ) : activeTab === 'MATCH' ? (
          <div>
            <button
              onClick={() => setActiveTab('BILLS')}
              className="mb-4 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded"
            >
              ← Back to Details
            </button>
            <ThreeWayMatchWorkspace
              billNumber={activeBillDetail.bill.billNumber}
              supplierInvoiceNumber={activeBillDetail.bill.supplierInvoiceNumber}
              supplierName={activeBillDetail.bill.supplierName}
              poNumber={activeBillDetail.bill.poNumber || undefined}
              grnNumber={activeBillDetail.bill.grnNumber || undefined}
              matchStatus={activeBillDetail.bill.matchStatus}
              matchOverrideReason={activeBillDetail.bill.matchOverrideReason}
              lines={activeBillDetail.lines.map((l) => ({
                lineNumber: l.lineNumber,
                description: l.descriptionSnapshot,
                uom: l.uom,
                billedQty: l.billedQuantity,
                billedUnitPrice: l.unitPrice,
                billedLineTotal: l.lineTotal,
              }))}
              exceptions={activeBillDetail.exceptions || []}
              onRunMatch={async (tols) => {
                await onRunMatch(selectedBillId, tols);
                await handleRefreshDetail();
              }}
              onOverrideMatch={async (reason) => {
                await onOverrideMatch(selectedBillId, reason);
                await handleRefreshDetail();
              }}
            />
          </div>
        ) : (
          <SupplierBillDetailsView
            data={activeBillDetail}
            onBack={handleBackToList}
            onOpenMatchWorkspace={() => setActiveTab('MATCH')}
            onApprove={async () => {
              await onApproveBill(selectedBillId);
              await handleRefreshDetail();
            }}
            onPost={async () => {
              await onPostBill(selectedBillId);
              await handleRefreshDetail();
            }}
            onCancel={async (reason) => {
              await onCancelBill(selectedBillId, reason);
              await handleRefreshDetail();
            }}
          />
        )
      ) : activeTab === 'EXCEPTIONS' ? (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="text-base font-semibold text-rose-300">Open Procurement Match Exceptions Queue</h2>
          <p className="text-xs text-slate-400">
            The following supplier bills contain unresolved price or quantity discrepancies requiring review or authorized override.
          </p>
          <SupplierBillListTable
            bills={exceptionsList}
            onSelectBill={handleSelectBill}
            onNewBill={() => setIsFormOpen(true)}
          />
        </div>
      ) : (
        <SupplierBillListTable
          bills={bills}
          onSelectBill={handleSelectBill}
          onNewBill={() => setIsFormOpen(true)}
        />
      )}

      {/* Form Modal */}
      <SupplierBillFormModal
        isOpen={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        purchaseOrders={purchaseOrders}
        onSubmit={onCreateBill}
      />
    </div>
  );
};
