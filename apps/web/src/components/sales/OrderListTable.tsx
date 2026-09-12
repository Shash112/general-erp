import React from 'react';

export interface SalesOrderSummary {
  id: string;
  orderNumber: string;
  quotationNumber: string;
  revisionNumber: number;
  customerId: string;
  orderDate: string;
  currency: string;
  status: 'DRAFT' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED';
  totalAmount: string;
  creditOverrideReason?: string | null;
}

interface OrderListTableProps {
  orders: SalesOrderSummary[];
  onSelectOrder: (id: string) => void;
  selectedOrderId?: string;
}

export const OrderListTable: React.FC<OrderListTableProps> = ({
  orders,
  onSelectOrder,
  selectedOrderId
}) => {
  const getStatusBadge = (status: string) => {
    let bg = '#e2e8f0';
    let fg = '#475569';
    if (status === 'CONFIRMED') { bg = '#dbeafe'; fg = '#1e40af'; }
    if (status === 'COMPLETED') { bg = '#dcfce7'; fg = '#166534'; }
    if (status === 'CANCELLED') { bg = '#fee2e2'; fg = '#991b1b'; }

    return (
      <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600, backgroundColor: bg, color: fg }}>
        {status}
      </span>
    );
  };

  if (orders.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', backgroundColor: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', color: '#64748b' }}>
        No Sales Orders found matching the search criteria.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #cbd5e1', borderRadius: '6px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
        <thead>
          <tr style={{ backgroundColor: '#f1f5f9', borderBottom: '1px solid #cbd5e1' }}>
            <th style={{ padding: '10px 12px' }}>Order Number</th>
            <th style={{ padding: '10px 12px' }}>Quotation Ref</th>
            <th style={{ padding: '10px 12px' }}>Order Date</th>
            <th style={{ padding: '10px 12px' }}>Customer</th>
            <th style={{ padding: '10px 12px' }}>Status</th>
            <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total Amount</th>
            <th style={{ padding: '10px 12px', textAlign: 'center' }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {orders.map(order => {
            const isSelected = order.id === selectedOrderId;
            return (
              <tr
                key={order.id}
                style={{
                  borderBottom: '1px solid #e2e8f0',
                  backgroundColor: isSelected ? '#eff6ff' : '#ffffff',
                  cursor: 'pointer'
                }}
                onClick={() => onSelectOrder(order.id)}
              >
                <td style={{ padding: '10px 12px', fontWeight: 600, color: '#1d4ed8' }}>
                  {order.orderNumber}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  {order.quotationNumber} (Rev {order.revisionNumber})
                </td>
                <td style={{ padding: '10px 12px' }}>{order.orderDate}</td>
                <td style={{ padding: '10px 12px', color: '#475569' }}>{order.customerId.slice(0, 8)}...</td>
                <td style={{ padding: '10px 12px' }}>{getStatusBadge(order.status)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>
                  {order.currency} ₹{parseFloat(order.totalAmount).toFixed(2)}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); onSelectOrder(order.id); }}
                    style={{ padding: '4px 8px', fontSize: '12px', backgroundColor: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    Inspect
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
