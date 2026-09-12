import React, { useState } from 'react';
import { DeliveryListTable, SalesDeliverySummary } from './DeliveryListTable.js';
import { DeliveryDetailsView, FullSalesDelivery } from './DeliveryDetailsView.js';

interface SalesDeliveryHubProps {
  deliveries: FullSalesDelivery[];
  onPickDelivery: (id: string) => Promise<void>;
  onPackDelivery: (id: string) => Promise<void>;
  onDispatchDelivery: (id: string) => Promise<void>;
  onDeliverDelivery: (id: string) => Promise<void>;
  onCancelDelivery: (id: string, reason: string) => Promise<void>;
}

export const SalesDeliveryHub: React.FC<SalesDeliveryHubProps> = ({
  deliveries,
  onPickDelivery,
  onPackDelivery,
  onDispatchDelivery,
  onDeliverDelivery,
  onCancelDelivery
}) => {
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | undefined>(deliveries[0]?.id);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const filteredDeliveries = deliveries.filter(d => {
    if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      if (
        !d.deliveryNumber.toLowerCase().includes(s) &&
        !d.salesOrderNumber.toLowerCase().includes(s) &&
        (!d.transporterName || !d.transporterName.toLowerCase().includes(s))
      ) {
        return false;
      }
    }
    return true;
  });

  const selectedDelivery = deliveries.find(d => d.id === selectedDeliveryId);

  const deliverySummaries: SalesDeliverySummary[] = filteredDeliveries.map(d => ({
    id: d.id,
    deliveryNumber: d.deliveryNumber,
    salesOrderNumber: d.salesOrderNumber,
    customerId: d.customerId,
    deliveryDate: d.deliveryDate,
    transporterName: d.transporterName,
    lrNumber: d.lrNumber,
    status: d.status,
    lineCount: d.lines.length
  }));

  return (
    <div style={{ padding: '24px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px', color: '#0f172a' }}>Sales Delivery & Dispatch Workbench</h1>
          <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '13px' }}>
            Manage warehouse picking, packing, dispatch, and customer delivery fulfillment.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="Search delivery, order, or transporter..."
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
          <option value="PICKED">PICKED</option>
          <option value="PACKED">PACKED</option>
          <option value="DISPATCHED">DISPATCHED</option>
          <option value="DELIVERED">DELIVERED</option>
          <option value="CANCELLED">CANCELLED</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedDelivery ? '1fr 1fr' : '1fr', gap: '20px' }}>
        <div>
          <DeliveryListTable
            deliveries={deliverySummaries}
            onSelectDelivery={id => setSelectedDeliveryId(id)}
            selectedDeliveryId={selectedDeliveryId}
          />
        </div>

        {selectedDelivery && (
          <div>
            <DeliveryDetailsView
              delivery={selectedDelivery}
              onPick={() => onPickDelivery(selectedDelivery.id)}
              onPack={() => onPackDelivery(selectedDelivery.id)}
              onDispatch={() => onDispatchDelivery(selectedDelivery.id)}
              onDeliver={() => onDeliverDelivery(selectedDelivery.id)}
              onCancel={reason => onCancelDelivery(selectedDelivery.id, reason)}
              onClose={() => setSelectedDeliveryId(undefined)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
