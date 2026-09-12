import React from 'react';

export interface QuotationActionToolbarProps {
  status: string;
  onSubmitForApproval: () => void;
  onApprove: () => void;
  onReject: () => void;
  onSend: () => void;
  onAccept: () => void;
  onCreateRevision: () => void;
  onCancel: () => void;
  onIssueContract: () => void;
}

export function QuotationActionToolbar({
  status,
  onSubmitForApproval,
  onApprove,
  onReject,
  onSend,
  onAccept,
  onCreateRevision,
  onCancel,
  onIssueContract
}: QuotationActionToolbarProps) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', backgroundColor: '#f1f5f9', padding: '0.75rem 1rem', borderRadius: '6px', margin: '1rem 0' }}>
      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569', marginRight: '0.5rem' }}>
        Lifecycle Actions (Current: <strong style={{ color: '#0f172a' }}>{status}</strong>):
      </span>

      {status === 'DRAFT' && (
        <>
          <button type="button" onClick={onSubmitForApproval} style={{ backgroundColor: '#2563eb', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            Submit for Approval
          </button>
          <button type="button" onClick={onCancel} style={{ backgroundColor: '#dc2626', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            Cancel Draft
          </button>
        </>
      )}

      {status === 'PENDING_APPROVAL' && (
        <>
          <button type="button" onClick={onApprove} style={{ backgroundColor: '#16a34a', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            Approve Quotation
          </button>
          <button type="button" onClick={onReject} style={{ backgroundColor: '#dc2626', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            Reject Quotation
          </button>
        </>
      )}

      {status === 'APPROVED' && (
        <>
          <button type="button" onClick={onSend} style={{ backgroundColor: '#0284c7', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            Send to Customer (Freeze Snapshots)
          </button>
          <button type="button" onClick={onCancel} style={{ backgroundColor: '#dc2626', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            Cancel Quotation
          </button>
        </>
      )}

      {status === 'SENT' && (
        <>
          <button type="button" onClick={onAccept} style={{ backgroundColor: '#16a34a', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            Record Customer Acceptance
          </button>
          <button type="button" onClick={onCreateRevision} style={{ backgroundColor: '#d97706', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
            Create Revision (Rev N+1)
          </button>
        </>
      )}

      {status === 'REJECTED' && (
        <button type="button" onClick={onCreateRevision} style={{ backgroundColor: '#d97706', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
          Create Revision from Rejected Quote
        </button>
      )}

      {status === 'ACCEPTED' && (
        <button type="button" onClick={onIssueContract} style={{ backgroundColor: '#7c3aed', color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
          Issue Conversion Contract (Phase 3.1 Contract Envelope)
        </button>
      )}
    </div>
  );
}

export default QuotationActionToolbar;
