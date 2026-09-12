import React, { useState } from 'react';
import { OrderListTable, SalesOrderSummary } from './OrderListTable.js';
import { OrderDetailsView, FullSalesOrder } from './OrderDetailsView.js';

interface SalesOrderHubProps {
  orders: FullSalesOrder[];
  onConfirmOrder: (id: string, overrideReason?: string) => Promise<void>;
  onCancelOrder: (id: string, reason: string) => Promise<void>;
}

export const SalesOrderHub: React.FC<SalesOrderHubProps> = ({
  orders,
  onConfirmOrder,
  onCancelOrder
}) => {
  const [selectedOrderId, setSelectedOrderId] = useState<string | undefined>(orders[0]?.id);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const filteredOrders = orders.filter(o => {
    if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;
    if (search && !o.orderNumber.toLowerCase().includes(search.toLowerCase()) && !o.quotationNumber.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  const selectedOrder = orders.find(o => o.id === selectedOrderId);

  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#0f172a' }}>Sales Order Workbench</h1>
          <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>
            Manage Sales Orders converted from Accepted Quotation Contracts.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search by order number or quotation..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', width: '300px', fontSize: '13px' }}
        />

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }}
        >
          <option value="ALL">All Statuses</option>
          <option value="DRAFT">DRAFT</option>
          <option value="CONFIRMED">CONFIRMED</option>
          <option value="CANCELLED">CANCELLED</option>
          <option value="COMPLETED">COMPLETED</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedOrder ? '1fr 1fr' : '1fr', gap: '20px' }}>
        <div>
          <OrderListTable
            orders={filteredOrders}
            onSelectOrder={id => setSelectedOrderId(id)}
            selectedOrderId={selectedOrderId}
          />
        </div>

        {selectedOrder && (
          <div>
            <OrderDetailsView
              order={selectedOrder}
              onConfirm={(overrideReason) => onConfirmOrder(selectedOrder.id, overrideReason)}
              onCancel={(reason) => onCancelOrder(selectedOrder.id, reason)}
              onClose={() => setSelectedOrderId(undefined)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
