import React from 'react';

export interface SalesDeliverySummary {
  id: string;
  deliveryNumber: string;
  salesOrderNumber: string;
  customerId: string;
  deliveryDate: string;
  transporterName?: string | null;
  lrNumber?: string | null;
  status: 'DRAFT' | 'PICKED' | 'PACKED' | 'DISPATCHED' | 'DELIVERED' | 'CANCELLED';
  lineCount: number;
}

interface DeliveryListTableProps {
  deliveries: SalesDeliverySummary[];
  onSelectDelivery: (id: string) => void;
  selectedDeliveryId?: string | undefined;
}

export const DeliveryListTable: React.FC<DeliveryListTableProps> = ({
  deliveries,
  onSelectDelivery,
  selectedDeliveryId
}) => {
  const getStatusBadgeStyle = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return { bg: '#f1f5f9', fg: '#475569' };
      case 'PICKED':
        return { bg: '#e0f2fe', fg: '#0369a1' };
      case 'PACKED':
        return { bg: '#fef3c7', fg: '#b45309' };
      case 'DISPATCHED':
        return { bg: '#ddd6fe', fg: '#6d28d9' };
      case 'DELIVERED':
        return { bg: '#dcfce7', fg: '#15803d' };
      case 'CANCELLED':
        return { bg: '#fee2e2', fg: '#b91c1c' };
      default:
        return { bg: '#f1f5f9', fg: '#475569' };
    }
  };

  return (
    <div style={{ background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
        <thead>
          <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
            <th style={{ padding: '12px 16px' }}>Delivery No</th>
            <th style={{ padding: '12px 16px' }}>Sales Order</th>
            <th style={{ padding: '12px 16px' }}>Date</th>
            <th style={{ padding: '12px 16px' }}>Transporter / LR</th>
            <th style={{ padding: '12px 16px' }}>Status</th>
            <th style={{ padding: '12px 16px', textAlign: 'center' }}>Lines</th>
          </tr>
        </thead>
        <tbody>
          {deliveries.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#94a3b8' }}>
                No sales deliveries found.
              </td>
            </tr>
          ) : (
            deliveries.map(d => {
              const badge = getStatusBadgeStyle(d.status);
              const isSelected = d.id === selectedDeliveryId;
              return (
                <tr
                  key={d.id}
                  onClick={() => onSelectDelivery(d.id)}
                  style={{
                    borderBottom: '1px solid #f1f5f9',
                    cursor: 'pointer',
                    background: isSelected ? '#f0f9ff' : 'transparent',
                    transition: 'background 0.15s ease'
                  }}
                >
                  <td style={{ padding: '12px 16px', fontWeight: 600, color: '#0f172a' }}>
                    {d.deliveryNumber}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#334155' }}>
                    {d.salesOrderNumber}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>
                    {d.deliveryDate}
                  </td>
                  <td style={{ padding: '12px 16px', color: '#64748b' }}>
                    {d.transporterName ? `${d.transporterName} (${d.lrNumber || 'No LR'})` : '—'}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 600,
                        backgroundColor: badge.bg,
                        color: badge.fg
                      }}
                    >
                      {d.status}
                    </span>
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: '#64748b' }}>
                    {d.lineCount}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
};
