import React from 'react';

interface SupplierDebitNoteDetailsViewProps {
  debitNote: any;
  lines: any[];
  onBack: () => void;
  onApprove: () => Promise<void>;
  onPost: () => Promise<void>;
  onCancel: () => Promise<void>;
}

export const SupplierDebitNoteDetailsView: React.FC<SupplierDebitNoteDetailsViewProps> = ({
  debitNote,
  lines,
  onBack,
  onApprove,
  onPost,
  onCancel,
}) => {
  if (!debitNote) return null;

  return (
    <div style={{ background: '#ffffff', borderRadius: '12px', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid #e5e7eb', paddingBottom: '16px' }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#059669', cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem', marginBottom: '8px' }}>← Back to Debit Notes</button>
          <h2 style={{ fontSize: '1.375rem', fontWeight: 700, color: '#111827', margin: 0 }}>Supplier Debit Note #{debitNote.debitNoteNumber}</h2>
          <p style={{ fontSize: '0.875rem', color: '#6b7280', margin: '4px 0 0 0' }}>Supplier ID: {debitNote.supplierId} | Status: <strong style={{ color: '#059669' }}>{debitNote.status}</strong></p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {['DRAFT', 'SUBMITTED'].includes(debitNote.status) && (
            <button onClick={onApprove} style={{ background: '#059669', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>Approve Debit Note</button>
          )}
          {['APPROVED', 'DRAFT', 'SUBMITTED'].includes(debitNote.status) && debitNote.status !== 'POSTED' && (
            <button onClick={onPost} style={{ background: '#10b981', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>Post to AP & GL</button>
          )}
          {debitNote.status !== 'POSTED' && debitNote.status !== 'CANCELLED' && (
            <button onClick={onCancel} style={{ background: '#dc2626', color: '#ffffff', border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: 600, cursor: 'pointer' }}>Cancel Debit Note</button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px', background: '#f0fdf4', padding: '16px', borderRadius: '8px', border: '1px solid #bbf7d0' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#166534' }}>Debit Note Date</div>
          <div style={{ fontWeight: 600, color: '#0f172a' }}>{debitNote.debitNoteDate}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#166534' }}>AP Document ID</div>
          <div style={{ fontWeight: 600, color: '#0f172a' }}>{debitNote.apDocumentId || 'Pending'}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#166534' }}>GL Journal ID</div>
          <div style={{ fontWeight: 600, color: '#0f172a' }}>{debitNote.journalEntryId || 'Pending'}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.75rem', color: '#166534' }}>Total Financial Claim</div>
          <div style={{ fontWeight: 700, color: '#047857', fontSize: '1.125rem' }}>₹{debitNote.totalAmount}</div>
        </div>
      </div>

      <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#1e293b', marginBottom: '12px' }}>Debit Note Items</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ background: '#f1f5f9', borderBottom: '1px solid #e2e8f0', color: '#475569', fontWeight: 600 }}>
            <th style={{ padding: '10px' }}>#</th>
            <th style={{ padding: '10px' }}>Description</th>
            <th style={{ padding: '10px' }}>UOM</th>
            <th style={{ padding: '10px' }}>Quantity</th>
            <th style={{ padding: '10px' }}>Unit Price</th>
            <th style={{ padding: '10px' }}>Taxable Amount</th>
            <th style={{ padding: '10px' }}>Tax Amount</th>
            <th style={{ padding: '10px' }}>Total Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '10px' }}>{line.lineNumber}</td>
              <td style={{ padding: '10px', fontWeight: 500 }}>{line.description}</td>
              <td style={{ padding: '10px' }}>{line.uom}</td>
              <td style={{ padding: '10px', fontWeight: 600 }}>{line.returnedQuantity}</td>
              <td style={{ padding: '10px' }}>₹{line.unitPrice}</td>
              <td style={{ padding: '10px' }}>₹{line.taxableAmount}</td>
              <td style={{ padding: '10px' }}>₹{line.taxAmount}</td>
              <td style={{ padding: '10px', fontWeight: 600, color: '#047857' }}>₹{line.lineTotal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
