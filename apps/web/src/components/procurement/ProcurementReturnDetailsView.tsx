import React from 'react';

interface ProcurementReturnDetailsViewProps {
  returnRecord: any;
  lines: any[];
  onBack: () => void;
  onSubmit: () => Promise<void>;
  onApprove: () => Promise<void>;
  onComplete: () => Promise<void>;
  onCancel: () => Promise<void>;
  onCreateDebitNote: () => void;
}

export const ProcurementReturnDetailsView: React.FC<ProcurementReturnDetailsViewProps> = ({
  returnRecord,
  lines,
  onBack,
  onSubmit,
  onApprove,
  onComplete,
  onCancel,
  onCreateDebitNote,
}) => {
  if (!returnRecord) return null;

  return (
    <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid #e5e7eb', paddingBottom: '16px' }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', marginBottom: '8px' }}>← Back to Returns List</button>
          <h2 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#111827', margin: 0 }}>Return #{returnRecord.returnNumber}</h2>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '4px 0 0 0' }}>Supplier ID: {returnRecord.supplierId} | Status: <strong style={{ color: '#2563eb' }}>{returnRecord.status}</strong></p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {returnRecord.status === 'DRAFT' && (
            <button onClick={onSubmit} style={{ background: '#2563eb', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>Submit Return</button>
          )}
          {['DRAFT', 'SUBMITTED'].includes(returnRecord.status) && (
            <button onClick={onApprove} style={{ background: '#059669', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>Approve Return</button>
          )}
          {['APPROVED', 'SUBMITTED'].includes(returnRecord.status) && (
            <button onClick={onComplete} style={{ background: '#7c3aed', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>Complete Return</button>
          )}
          {['APPROVED', 'COMPLETED'].includes(returnRecord.status) && !returnRecord.debitNoteId && (
            <button onClick={onCreateDebitNote} style={{ background: '#d97706', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>+ Generate Debit Note</button>
          )}
          {returnRecord.status !== 'CANCELLED' && (
            <button onClick={onCancel} style={{ background: '#dc2626', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>Cancel Return</button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px', background: '#f8fafc', padding: '16px', borderRadius: '8px' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Return Date</div>
          <div style={{ fontWeight: 600, color: '#0f172a' }}>{returnRecord.returnDate}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Reason</div>
          <div style={{ fontWeight: 600, color: '#0f172a' }}>{returnRecord.reason}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Total Amount</div>
          <div style={{ fontWeight: 700, color: '#16a34a', fontSize: '1.125rem' }}>₹{returnRecord.totalAmount}</div>
        </div>
      </div>

      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#1e293b', marginBottom: '12px' }}>Returned Line Items</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 600 }}>
            <th style={{ padding: '10px' }}>#</th>
            <th style={{ padding: '10px' }}>Description</th>
            <th style={{ padding: '10px' }}>UOM</th>
            <th style={{ padding: '10px' }}>Returned Qty</th>
            <th style={{ padding: '10px' }}>Unit Price</th>
            <th style={{ padding: '10px' }}>Taxable Amount</th>
            <th style={{ padding: '10px' }}>Tax Amount</th>
            <th style={{ padding: '10px' }}>Line Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '10px' }}>{line.lineNumber}</td>
              <td style={{ padding: '10px', fontWeight: 500 }}>{line.description}</td>
              <td style={{ padding: '10px' }}>{line.uom}</td>
              <td style={{ padding: '10px', fontWeight: 600, color: '#dc2626' }}>{line.returnedQuantity}</td>
              <td style={{ padding: '10px' }}>₹{line.unitPrice}</td>
              <td style={{ padding: '10px' }}>₹{line.taxableAmount}</td>
              <td style={{ padding: '10px' }}>₹{line.taxAmount}</td>
              <td style={{ padding: '10px', fontWeight: 600 }}>₹{line.lineTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
