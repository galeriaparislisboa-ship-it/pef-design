export const demoListings = [
  {id:'neptune', title:'Applique Neptune', category:'Lighting', city:'Lisbonne', price:520, status:'available'},
  {id:'opaline', title:'Suspension Opaline', category:'Lighting', city:'Porto', price:360, status:'available'},
  {id:'atlas', title:'Vase Atlas', category:'Ceramics', city:'Lisbonne', price:380, status:'available'},
];

const normalize = value => value.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function matches(listing, filters) {
  return listing.status === 'available'
    && (!filters.category || listing.category === filters.category)
    && (!filters.city || normalize(listing.city) === normalize(filters.city))
    && (filters.maxPrice === null || listing.price <= filters.maxPrice);
}

export function refreshAlerts(state) {
  for (const alert of state.alerts) {
    const previous = new Set(alert.matches);
    alert.matches = state.listings.filter(listing => matches(listing, alert)).map(listing => listing.id);
    alert.pending = [...new Set([...alert.pending, ...alert.matches.filter(id => !previous.has(id))])]
      .filter(id => alert.matches.includes(id));
  }
}

export function previewDigest(state, day) {
  refreshAlerts(state);
  const ids = new Set(state.alerts.flatMap(alert => alert.pending));
  if (!ids.size || state.lastDigest?.day === day) return null;
  for (const alert of state.alerts) alert.pending = [];
  state.lastDigest = {day, listings:state.listings.filter(listing => ids.has(listing.id))};
  return state.lastDigest;
}
