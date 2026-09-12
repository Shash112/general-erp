import React, { useState } from 'react';
import { SupplierDebitNoteListTable, SupplierDebitNoteItem } from './SupplierDebitNoteListTable';
import { SupplierDebitNoteDetailsView } from './SupplierDebitNoteDetailsView';

interface SupplierDebitNoteHubProps {
  companyId: string;
}

export const SupplierDebitNoteHub: React.FC<SupplierDebitNoteHubProps> = ({ companyId }) => {
  const [debitNotes, setDebitNotes] = useState<SupplierDebitNoteItem[]>([
    {
      id: 'sdn_sample_1',
      debitNoteNumber: 'SDN-2026-0001',
      supplierId: 'sup_001',
      debitNoteDate: new Date().toISOString().split('T')[0],
      reason: 'Quality failure on raw material',
      status: 'APPROVED',
      subtotalAmount: '5000.00',
      taxAmount: '900.00',
      totalAmount: '5900.00',
      createdAt: new Date().toISOString(),
    },
  ]);

  const [selectedDebitNote, setSelectedDebitNote] = useState<SupplierDebitNoteItem | null>(null);
  const [lines, setLines] = useState<any[]>([
    {
      id: 'sdnl_1',
      lineNumber: 1,
      description: 'Industrial Steel Plates',
      uom: 'KG',
      returnedQuantity: '10.0000',
      unitPrice: '500.00',
      taxableAmount: '5000.00',
      taxAmount: '900.00',
      lineTotal: '5900.00',
    },
  ]);

  const handleCreateNew = () => {
    const newNote: SupplierDebitNoteItem = {
      id: `sdn_${Date.now()}`,
      debitNoteNumber: `SDN-2026-000${debitNotes.length + 1}`,
      supplierId: 'sup_001',
      debitNoteDate: new Date().toISOString().split('T')[0],
      reason: 'Supplier Quality Claim',
      status: 'DRAFT',
      subtotalAmount: '5000.00',
      taxAmount: '900.00',
      totalAmount: '5900.00',
      createdAt: new Date().toISOString(),
    };
    setDebitNotes([newNote, ...debitNotes]);
  };

  const handleApprove = async () => {
    if (selectedDebitNote) {
      setSelectedDebitNote({ ...selectedDebitNote, status: 'APPROVED' });
      setDebitNotes(debitNotes.map(d => d.id === selectedDebitNote.id ? { ...d, status: 'APPROVED' } : d));
    }
  };

  const handlePost = async () => {
    if (selectedDebitNote) {
      setSelectedDebitNote({ ...selectedDebitNote, status: 'POSTED', apDocumentId: 'apdoc_001' });
      setDebitNotes(debitNotes.map(d => d.id === selectedDebitNote.id ? { ...d, status: 'POSTED', apDocumentId: 'apdoc_001' } : d));
    }
  };

  const handleCancel = async () => {
    if (selectedDebitNote) {
      setSelectedDebitNote({ ...selectedDebitNote, status: 'CANCELLED' });
      setDebitNotes(debitNotes.map(d => d.id === selectedDebitNote.id ? { ...d, status: 'CANCELLED' } : d));
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px' }}>
      {selectedDebitNote ? (
        <SupplierDebitNoteDetailsView
          debitNote={selectedDebitNote}
          lines={lines}
          onBack={() => setSelectedDebitNote(null)}
          onApprove={handleApprove}
          onPost={handlePost}
          onCancel={handleCancel}
        />
      ) : (
        <SupplierDebitNoteListTable
          debitNotes={debitNotes}
          onSelectDebitNote={(dn) => setSelectedDebitNote(dn)}
          onCreateNew={handleCreateNew}
        />
      )}
    </div>
  );
};
