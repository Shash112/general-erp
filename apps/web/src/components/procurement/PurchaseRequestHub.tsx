import React, { useState } from 'react';
import { PurchaseRequestListTable, PurchaseRequestListItem } from './PurchaseRequestListTable';
import { PurchaseRequestFormModal, PurchaseRequestFormValues } from './PurchaseRequestFormModal';
import { PurchaseRequestDetailsView } from './PurchaseRequestDetailsView';

interface PurchaseRequestHubProps {
  companyId: string;
}

export const PurchaseRequestHub: React.FC<PurchaseRequestHubProps> = ({ companyId }) => {
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);

  // Mock data for UI demonstration
  const [mockRequests, setMockRequests] = useState<any[]>([
    {
      id: 'pr_01',
      requestNumber: 'PR-2026-0001',
      requestDate: '2026-09-12',
      requiredDate: '2026-09-19',
      requesterUserId: 'user_procurement_mgr',
      departmentId: 'dept_mfg',
      priority: 'HIGH',
      status: 'SUBMITTED',
      purpose: 'Raw Material Batch for Q3 Operations',
      justification: 'Stock replenishment needed to meet production schedules.',
      estimatedTotal: '5000.00',
      currency: 'INR',
      lines: [
        {
          id: 'prl_01',
          lineNumber: 1,
          description: 'High-Grade Steel Alloy Rods 10mm',
          requestedQuantity: '10.0000',
          orderedQuantity: '0.0000',
          remainingQuantity: '10.0000',
          uom: 'PCS',
          estimatedUnitPrice: '500.00',
          estimatedLineTotal: '5000.00',
        }
      ]
    }
  ]);

  const filteredRequests = mockRequests.filter(req => {
    if (activeTab === 'ALL') return true;
    return req.status === activeTab;
  });

  const selectedRequest = mockRequests.find(r => r.id === selectedRequestId);

  const handleCreateSubmit = async (values: PurchaseRequestFormValues) => {
    const newPr = {
      id: `pr_${Date.now()}`,
      requestNumber: `PR-2026-${Math.floor(1000 + Math.random() * 9000)}`,
      requestDate: new Date().toISOString().split('T')[0],
      requiredDate: values.requiredDate,
      requesterUserId: 'user_current',
      priority: values.priority,
      status: 'DRAFT',
      purpose: values.purpose,
      justification: values.justification,
      notes: values.notes,
      currency: 'INR',
      estimatedTotal: values.lines.reduce((sum, line) => {
        const lineVal = (parseFloat(line.requestedQuantity) || 0) * (parseFloat(line.estimatedUnitPrice) || 0);
        return sum + lineVal;
      }, 0).toFixed(2),
      lines: values.lines.map((l, i) => ({
        id: `prl_${Date.now()}_${i}`,
        lineNumber: i + 1,
        description: l.description,
        requestedQuantity: l.requestedQuantity,
        orderedQuantity: '0.0000',
        remainingQuantity: l.requestedQuantity,
        uom: l.uom,
        estimatedUnitPrice: l.estimatedUnitPrice,
        estimatedLineTotal: ((parseFloat(l.requestedQuantity) || 0) * (parseFloat(l.estimatedUnitPrice) || 0)).toFixed(2)
      }))
    };

    setMockRequests([newPr, ...mockRequests]);
  };

  const handleSubmit = async (id: string) => {
    setMockRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'SUBMITTED', submittedAt: new Date(), submittedBy: 'user_current' } : r));
  };

  const handleApprove = async (id: string) => {
    setMockRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'APPROVED', approvedAt: new Date(), approvedBy: 'user_approver' } : r));
  };

  const handleReject = async (id: string, reason: string) => {
    setMockRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'REJECTED', rejectedAt: new Date(), rejectedBy: 'user_approver', rejectionReason: reason } : r));
  };

  const handleCancel = async (id: string, reason: string) => {
    setMockRequests(prev => prev.map(r => r.id === id ? { ...r, status: 'CANCELLED', cancelledAt: new Date(), cancelledBy: 'user_current', cancellationReason: reason } : r));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between pb-4 border-b border-slate-800 gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-white flex items-center gap-3">
            Procurement Workbench
            <span className="text-xs bg-indigo-950 text-indigo-400 border border-indigo-800 px-2 py-0.5 rounded font-mono font-medium">Phase 3.6</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">Manage operational purchase requisitions and demand lifecycle</p>
        </div>

        {/* Tab Filters */}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-xl">
          {['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'].map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setSelectedRequestId(null); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {selectedRequest ? (
        <PurchaseRequestDetailsView
          request={selectedRequest}
          onBack={() => setSelectedRequestId(null)}
          onSubmit={handleSubmit}
          onApprove={handleApprove}
          onReject={handleReject}
          onCancel={handleCancel}
        />
      ) : (
        <PurchaseRequestListTable
          requests={filteredRequests}
          onSelectRequest={(id) => setSelectedRequestId(id)}
          onNewRequest={() => setIsModalOpen(true)}
        />
      )}

      <PurchaseRequestFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateSubmit}
        companyId={companyId}
      />
    </div>
  );
};
