"""Directional interface costs and logical /30 endpoints; never physical cable discovery."""
import ipaddress


def snmp_cost_rows(device, tables):
    """RFC 1850 numbered interface, addressLessIf=0, TOS=0. No bandwidth-derived guess."""
    for index, value in tables.get('ifCost', {}).items():
        parts = index.split('.')
        if len(parts) != 6 or parts[-2:] != ['0', '0'] or not value.isdigit():
            continue
        address = '.'.join(parts[:4])
        if_index = tables.get('ipIfIndex', {}).get(address)
        name = tables.get('ifName', {}).get(if_index)
        if not name:
            continue
        neighbors = []
        for key, router in tables.get('nbrRouter', {}).items():
            peer = '.'.join(key.split('.')[:4])
            try:
                network = ipaddress.ip_network(f'{address}/{tables["ipMask"][address]}', strict=False)
                if ipaddress.ip_address(peer) in network and peer != address:
                    neighbors.append((peer, router, tables.get('nbrState', {}).get(key)))
            except (KeyError, ValueError):
                continue
        # An interface cost exists even when no neighbor is currently observed.
        for peer, router, state in neighbors or [(None, None, None)]:
            yield {'localNode': device.id, 'interface': name, 'localIp': address,
                   'neighborIp': peer, 'neighborRouterId': router, 'state': state,
                   'area': tables.get('ifArea', {}).get(f'{address}.0'), 'cost': int(value)}


def normalize_costs(rows, nodes, interfaces, at, age, fresh):
    records = [dict(row) for row in rows]
    # Index once: metric refresh must not scan all neighbors for every interface.
    identities = {}
    local_addresses = {}
    subnet_owners = {}
    for row in records:
        key = (row.get('localNode'), row.get('interface'), row.get('localIp'))
        entry = identities.setdefault(key, {'processes': set(), 'peers': set()})
        if row.get('process') not in {None, '', 'unknown'} and fresh(row, 'cost', at, age):
            entry['processes'].add(row['process'])
        if row.get('neighborRouterId'):
            entry['peers'].add(row['neighborRouterId'])
    for interface in interfaces.values():
        if not fresh(interface, 'ipv4', at, age):
            continue
        for address in interface.get('ipv4', []):
            try:
                ip = ipaddress.ip_interface(address)
                if ip.network.prefixlen != 30 or ip.ip not in ip.network.hosts():
                    continue
                local_addresses.setdefault((interface['nodeId'], interface['name'], str(ip.ip)), set()).add(ip.network)
                subnet_owners.setdefault(ip.network, set()).add((interface['nodeId'], interface['name'], str(ip.ip)))
            except ValueError:
                continue
    # CLI/SNMP observations of one numbered interface are merged, not drawn twice.
    grouped = {}
    for row in records:
        identity = (row.get('localNode'), row.get('interface'), row.get('localIp'))
        known = identities[identity]['processes']
        process = row.get('process')
        if process in {None, '', 'unknown'} and len(known) == 1:
            process = next(iter(known))
        peers = identities[identity]['peers']
        key = (*identity, process, row.get('neighborRouterId') if len(peers) > 1 else None)
        grouped.setdefault(key, []).append(row)
    output = []
    for candidates in grouped.values():
        def stamp(row, field):
            return row.get('provenance', {}).get(field, {}).get('observedAt', row.get('observedAt', 0))
        costs = [r for r in candidates if isinstance(r.get('cost'), (int, float))]
        selected = max(costs or candidates, key=lambda r: (fresh(r, 'cost', at, age), stamp(r, 'cost'), r.get('dataSource') == 'cli'))
        peers = {r.get('neighborRouterId') for r in candidates if r.get('neighborRouterId') and fresh(r, 'neighborRouterId', at, age)}
        row = dict(selected)
        for field in ['neighborRouterId', 'neighborIp']:
            if not fresh(row, field, at, age):
                row.pop(field, None)
        if len(peers) == 1 and not row.get('neighborRouterId'):
            peer = next(r for r in candidates if r.get('neighborRouterId') == next(iter(peers)))
            for field in ['neighborRouterId', 'neighborIp']:
                if peer.get(field):
                    row[field] = peer[field]
        networks = local_addresses.get((row.get('localNode'), row.get('interface'), row.get('localIp')), set())
        if len(networks) == 1:
            network = next(iter(networks))
            row['subnet'] = str(network)
            owners = subnet_owners[network]
            remote = [owner for owner in owners if owner[0] != row.get('localNode') and owner[2] != row.get('localIp')]
            local_owners = [owner for owner in owners if owner[2] == row.get('localIp')]
            if len(local_owners) != 1:
                remote = []
                row['peerResolution'] = 'ambiguous'
            if len(remote) == 1:
                target, interface, address = remote[0]
                router = nodes.get(target, {}).get('routerId')
                # Conflicting neighbor evidence or duplicate /30 ownership is never guessed.
                if not row.get('neighborRouterId') or row.get('neighborRouterId') == router:
                    row.update(targetNode=target, neighborIp=address, targetInterface=interface, peerResolution='numbered-/30')
                    if router:
                        row['neighborRouterId'] = router
            else:
                row.setdefault('peerResolution', 'ambiguous' if remote else 'unresolved')
        output.append(row)
    return output
