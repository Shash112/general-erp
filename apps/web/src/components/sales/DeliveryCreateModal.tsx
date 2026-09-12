import React, { useState } from 'react';
import { FullSalesOrder } from './OrderDetailsView.js';

interface DeliveryCreateModalProps {
  order: FullSalesOrder;
  onCreateDelivery: (input: {
    salesOrderId: string;
    deliveryDate: string;
    warehouseReference?: string;
    transporterName?: string;
    vehicleNumber?: string;
    lrNumber?: string;
    lrDate?: string;
    notes?: string;
    lines: Array<{ salesOrderLineId: string; deliveryQuantity: string }>;
  }) => Promise<void>;
  onClose: () => void;
}

export const DeliveryCreateModal: React.FC<DeliveryCreateModalProps> = ({
  order,
  onCreateDelivery,
  onClose
}) => {
  const [deliveryDate, setDeliveryDate] = useState<string>(new Date().toISOString().split('T')[0]!);
  const [transporterName, setTransporterName] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [lrNumber, setLrNumber] = useState('');
  const [lrDate, setLrDate] = useState('');
  const [warehouseRef, setWarehouseRef] = useState('MAIN_WH');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize line delivery quantities with default remaining quantities
  const [lineQuantities, setLineQuantities] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const line of order.lines) {
      const ordered = parseFloat(line.orderedQuantity);
      const delivered = parseFloat(line.deliveredQuantity || '0');
      const cancelled = parseFloat(line.cancelledQuantity || '0');
      const rem = Math.max(0, ordered - cancelled - delivered);
      initial[line.id] = rem.toFixed(2);
    }
    return initial;
  });

  const handleQtyChange = (lineId: string, value: string) => {
    setLineQuantities(prev => ({ ...prev, [lineId]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const activeLines = order.lines
        .filter(l => {
          const qty = parseFloat(lineQuantities[l.id] || '0');
          return !isNaN(qty) && qty > 0;
        })
        .map(l => ({
          salesOrderLineId: l.id,
          deliveryQuantity: parseFloat(lineQuantities[l.id]!).toFixed(4)
        }));

      if (activeLines.length === 0) {
        alert('Please enter at least one line with delivery quantity greater than zero.');
        return;
      }

      await onCreateDelivery({
        salesOrderId: order.id,
        deliveryDate,
        warehouseReference: warehouseRef,
        transporterName,
        vehicleNumber,
        lrNumber,
        lrDate,
        notes,
        lines: activeLines
      });

      onClose();
    } catch (err: any) {
      alert(err.message || 'Failed to create delivery.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(15, 23, 42, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>
      <div style={{
        background: '#ffffff',
        padding: '24px',
        borderRadius: '8px',
        width: '650px',
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 10px 25px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ margin: '0 0 16px 0', fontSize: '18px', color: '#0f172a' }}>
          Create Sales Delivery for Order {order.orderNumber}
        </h3>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Delivery Date *</label>
              <input
                type="date"
                required
                value={deliveryDate}
                onChange={e => setDeliveryDate(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Warehouse / Location</label>
              <input
                type="text"
                value={warehouseRef}
                onChange={e => setWarehouseRef(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Transporter Name</label>
              <input
                type="text"
                value={transporterName}
                onChange={e => setTransporterName(e.target.value)}
                placeholder="e.g. VRL Logistics"
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>Vehicle Number</label>
              <input
                type="text"
                value={vehicleNumber}
                onChange={e => setVehicleNumber(e.target.value)}
                placeholder="e.g. KA-01-AB-1234"
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>LR / Consignment No</label>
              <input
                type="text"
                value={lrNumber}
                onChange={e => setLrNumber(e.target.value)}
                placeholder="e.g. LR-98765"
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '4px' }}>LR Date</label>
              <input
                type="date"
                value={lrDate}
                onChange={e => setLrDate(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
              />
            </div>
          </div>

          <div style={{ marginBottom: '16px' }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#0f172a' }}>Delivery Line Quantities</h4>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                  <th style={{ padding: '8px', textAlign: 'left' }}>Product</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Ordered</th>
                  <th style={{ padding: '8px', textAlign: 'right' }}>Prev Delivered</th>
                  <th style={{ padding: '8px', textAlign: 'right', width: '120px' }}>This Delivery *</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map(line => {
                  const ordered = parseFloat(line.orderedQuantity);
                  const delivered = parseFloat(line.deliveredQuantity || '0');
                  const cancelled = parseFloat(line.cancelledQuantity || '0');
                  const rem = Math.max(0, ordered - cancelled - delivered);

                  return (
                    <tr key={line.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '8px' }}>
                        <div style={{ fontWeight: 600 }}>{line.productNameSnapshot}</div>
                        <div style={{ fontSize: '11px', color: '#64748b' }}>{line.productCodeSnapshot} ({line.uom})</div>
                      </td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>{ordered.toFixed(2)}</td>
                      <td style={{ padding: '8px', textAlign: 'right', color: '#64748b' }}>{delivered.toFixed(2)}</td>
                      <td style={{ padding: '8px', textAlign: 'right' }}>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          max={rem}
                          value={lineQuantities[line.id] || '0'}
                          onChange={e => handleQtyChange(line.id, e.target.value)}
                          style={{
                            width: '90px',
                            padding: '4px 6px',
                            borderRadius: '4px',
                            border: '1px solid #cbd5e1',
                            textAlign: 'right',
                            fontSize: '12px'
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #cbd5e1', background: '#fff', fontSize: '13px' }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600, fontSize: '13px' }}
            >
              {isSubmitting ? 'Creating...' : 'Create Delivery'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
