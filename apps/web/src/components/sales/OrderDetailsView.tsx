import React from 'react';
import { OrderLineTable } from './OrderLineTable.js';
import { CreditExposureCard } from './CreditExposureCard.js';
import { OrderFulfillmentProgress } from './OrderFulfillmentProgress.js';
import { OrderActionToolbar } from './OrderActionToolbar.js';

export interface FullSalesOrder {
  id: string;
  orderNumber: string;
  quotationId: string;
  quotationNumber: string;
  revisionNumber: number;
  conversionContractId: string;
  customerId: string;
  orderDate: string;
  currency: string;
  exchangeRate: string;
  salesRepresentativeId?: string | null;
  billingAddressSnapshot: Record<string, any>;
  shippingAddressSnapshot: Record<string, any>;
  contactSnapshot?: Record<string, any> | null;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  termsAndConditions?: string | null;
  subtotalAmount: string;
  headerDiscountAmount: string;
  discountAmount: string;
  taxableAmount: string;
  taxAmount: string;
  totalAmount: string;
  totalAmountBase: string;
  creditOverrideBy?: string | null;
  creditOverrideReason?: string | null;
  lines: any[];
}

interface OrderDetailsViewProps {
  order: FullSalesOrder;
  onConfirm: (overrideReason?: string) => Promise<void>;
  onCancel: (reason: string) => Promise<void>;
  onClose: () => void;
}

export const OrderDetailsView: React.FC<OrderDetailsViewProps> = ({
  order,
  onConfirm,
  onCancel,
  onClose
}) => {
  const totalDelivered = order.lines.reduce((acc, l) => acc + parseFloat(l.deliveredQuantity || '0'), 0);
  const totalInvoiced = order.lines.reduce((acc, l) => acc + parseFloat(l.invoicedQuantity || '0'), 0);
  const totalOrdered = order.lines.reduce((acc, l) => acc + parseFloat(l.orderedQuantity || '0'), 0);

  return (
    <div style={{ border: '1px solid #cbd5e1', borderRadius: '8px', backgroundColor: '#ffffff', overflow: 'hidden' }}>
      <OrderActionToolbar status={order.status} onConfirm={onConfirm} onCancel={onCancel} />

      <div style={{ padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#0f172a' }}>Sales Order {order.orderNumber}</h2>
            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
              Derived from Quotation <strong>{order.quotationNumber}</strong> (Revision {order.revisionNumber}) | Contract ID: {order.conversionContractId}
            </div>
          </div>
          <button onClick={onClose} style={{ padding: '4px 12px', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer' }}>
            Close Inspector
          </button>
        </div>

        <CreditExposureCard
          customerId={order.customerId}
          totalAmountBase={order.totalAmountBase}
          creditOverrideBy={order.creditOverrideBy}
          creditOverrideReason={order.creditOverrideReason}
        />

        <div style={{ marginBottom: '16px' }}>
          <OrderFulfillmentProgress
            status={order.status}
            orderedQuantity={totalOrdered.toString()}
            deliveredQuantity={totalDelivered.toString()}
            invoicedQuantity={totalInvoiced.toString()}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px', fontSize: '13px', backgroundColor: '#f8fafc', padding: '12px', borderRadius: '6px' }}>
          <div>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#475569' }}>Billing Address Snapshot</h4>
            <div>{order.billingAddressSnapshot.addressLine1 || 'N/A'}</div>
            <div>{order.billingAddressSnapshot.city}, {order.billingAddressSnapshot.state} - {order.billingAddressSnapshot.pincode}</div>
          </div>
          <div>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#475569' }}>Shipping Address Snapshot</h4>
            <div>{order.shippingAddressSnapshot.addressLine1 || 'N/A'}</div>
            <div>{order.shippingAddressSnapshot.city}, {order.shippingAddressSnapshot.state} - {order.shippingAddressSnapshot.pincode}</div>
          </div>
        </div>

        <h3 style={{ fontSize: '14px', marginBottom: '8px', color: '#1e293b' }}>Order Line Items</h3>
        <OrderLineTable lines={order.lines} />

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
          <div style={{ width: '280px', fontSize: '13px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span>Subtotal:</span>
              <span>₹{parseFloat(order.subtotalAmount).toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', color: '#059669' }}>
              <span>Discount:</span>
              <span>-₹{parseFloat(order.discountAmount).toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span>Taxable Subtotal:</span>
              <span>₹{parseFloat(order.taxableAmount).toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span>GST Tax Amount:</span>
              <span>₹{parseFloat(order.taxAmount).toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '2px solid #0f172a', fontWeight: 700, fontSize: '15px' }}>
              <span>Total Amount:</span>
              <span>{order.currency} ₹{parseFloat(order.totalAmount).toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
