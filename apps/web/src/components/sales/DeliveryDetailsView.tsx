import React from 'react';
import { DeliveryLineTable, SalesDeliveryLineItem } from './DeliveryLineTable.js';
import { DeliveryActionToolbar } from './DeliveryActionToolbar.js';

export interface FullSalesDelivery {
  id: string;
  deliveryNumber: string;
  salesOrderId: string;
  salesOrderNumber: string;
  customerId: string;
  deliveryDate: string;
  shippingAddressSnapshot: Record<string, any>;
  contactSnapshot?: Record<string, any> | null;
  warehouseReference?: string | null;
  transporterName?: string | null;
  vehicleNumber?: string | null;
  lrNumber?: string | null;
  lrDate?: string | null;
  notes?: string | null;
  status: 'DRAFT' | 'PICKED' | 'PACKED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
  pickedAt?: Date | string | null;
  packedAt?: Date | string | null;
  dispatchedAt?: Date | string | null;
  deliveredAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  cancellationReason?: string | null;
  lines: SalesDeliveryLineItem[];
}

interface DeliveryDetailsViewProps {
  delivery: FullSalesDelivery;
  onPick?: () => Promise<void>;
  onPack?: () => Promise<void>;
  onDispatch?: () => Promise<void>;
  onDeliver?: () => Promise<void>;
  onCancel?: (reason: string) => Promise<void>;
  onClose?: () => void;
}

export const DeliveryDetailsView: React.FC<DeliveryDetailsViewProps> = ({
  delivery,
  onPick,
  onPack,
  onDispatch,
  onDeliver,
  onCancel,
  onClose
}) => {
  return (
    <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#0f172a' }}>{delivery.deliveryNumber}</h2>
            <span style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: '4px' }}>
              {delivery.status}
            </span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b' }}>
            Order Ref: <strong>{delivery.salesOrderNumber}</strong> | Date: {delivery.deliveryDate}
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <DeliveryActionToolbar
            status={delivery.status}
            onPick={onPick}
            onPack={onPack}
            onDispatch={onDispatch}
            onDeliver={onDeliver}
            onCancel={onCancel}
          />
          {onClose && (
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94a3b8' }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px', background: '#f8fafc', padding: '12px', borderRadius: '6px' }}>
        <div>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '12px', textTransform: 'uppercase', color: '#64748b' }}>Shipping Destination</h4>
          <div style={{ fontSize: '13px', color: '#0f172a', fontWeight: 600 }}>
            {delivery.shippingAddressSnapshot?.addressLine1}
          </div>
          <div style={{ fontSize: '12px', color: '#475569' }}>
            {delivery.shippingAddressSnapshot?.city}, {delivery.shippingAddressSnapshot?.state} - {delivery.shippingAddressSnapshot?.postalCode}
          </div>
        </div>

        <div>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '12px', textTransform: 'uppercase', color: '#64748b' }}>Transport & Logistics</h4>
          <div style={{ fontSize: '12px', color: '#334155' }}>
            <strong>Transporter:</strong> {delivery.transporterName || '—'}
          </div>
          <div style={{ fontSize: '12px', color: '#334155' }}>
            <strong>Vehicle:</strong> {delivery.vehicleNumber || '—'}
          </div>
          <div style={{ fontSize: '12px', color: '#334155' }}>
            <strong>LR Number:</strong> {delivery.lrNumber || '—'} {delivery.lrDate ? `(${delivery.lrDate})` : ''}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#0f172a' }}>Delivery Items</h3>
        <DeliveryLineTable lines={delivery.lines} />
      </div>

      {delivery.cancellationReason && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: '6px', fontSize: '12px' }}>
          <strong>Cancellation Reason:</strong> {delivery.cancellationReason}
        </div>
      )}
    </div>
  );
};
