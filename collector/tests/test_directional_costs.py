from jtopology.graph import DependencyGraph
from jtopology.huawei import parse_outputs
from jtopology.models import Device
from jtopology.ospf import snmp_cost_rows
from test_discovery import fixture, NOW


def vlanifs():
    data = fixture()
    data['interfaces'] = [
        {'id': 'A:Vlanif100', 'nodeId': 'A', 'name': 'Vlanif100', 'ipv4': ['172.20.0.1/30'], 'observedAt': NOW},
        {'id': 'B:Vlanif100', 'nodeId': 'B', 'name': 'Vlanif100', 'ipv4': ['172.20.0.2/30'], 'observedAt': NOW},
    ]
    data['ospf'] = [
        {'id': 'a-cost', 'localNode': 'A', 'interface': 'Vlanif100', 'localIp': '172.20.0.1', 'cost': 10, 'process': '1', 'observedAt': NOW, 'dataSource': 'cli'},
        {'id': 'b-cost', 'localNode': 'B', 'interface': 'Vlanif100', 'localIp': '172.20.0.2', 'cost': 80, 'process': '2', 'observedAt': NOW, 'dataSource': 'cli'},
    ]
    return data


def test_cli_collects_interface_cost_without_neighbor_and_keeps_processes_separate():
    output = ('OSPF Process 1 with Router ID 10.0.0.1\nArea: 0.0.0.0\n'
              'Vlanif100 172.20.0.1 P2P P-2-P 10 1\n'
              'OSPF Process 2 with Router ID 10.0.0.1\nArea: 0.0.0.1\n'
              'Vlanif100 172.20.0.1 P2P P-2-P 80 1\n')
    rows = parse_outputs(Device('A', '192.0.2.1'), {'cost': output}, NOW).tables['ospf']
    assert [(r['process'], r['cost'], r['area']) for r in rows] == [('1', 10, '0.0.0.0'), ('2', 80, '0.0.0.1')]


def test_snmp_reads_actual_numbered_interface_metric_without_neighbor():
    tables = {'ifCost': {'172.20.0.1.0.0': '73', '172.20.0.1.0.4': '999', '0.0.0.0.8.0': '5'},
              'ipIfIndex': {'172.20.0.1': '100'}, 'ifName': {'100': 'Vlanif100'},
              'ipMask': {'172.20.0.1': '255.255.255.252'}, 'ifArea': {'172.20.0.1.0': '0.0.0.0'}}
    rows = list(snmp_cost_rows(Device('A', '192.0.2.1'), tables))
    assert len(rows) == 1 and rows[0]['cost'] == 73 and rows[0]['interface'] == 'Vlanif100'
    assert rows[0]['neighborRouterId'] is None


def test_private_30_resolves_logical_endpoints_and_independent_directional_costs():
    data = vlanifs()
    data['links'] = []
    graph = DependencyGraph(data, NOW)
    a, b = graph.ospf
    assert (a['targetNode'], a['neighborIp'], a['subnet'], a['cost']) == ('B', '172.20.0.2', '172.20.0.0/30', 10)
    assert (b['targetNode'], b['cost']) == ('A', 80)
    assert not graph.links  # a /30 does not discover a cable or a physical interface.


def test_vlanif_cost_is_available_with_physical_lfib_interface_and_parallel_circuits_need_next_hop():
    data = vlanifs()
    data['paths'][0]['hops'][0]['outgoingInterface'] = 'GE1'
    graph = DependencyGraph(data, NOW)
    segment = graph.paths['A:path1']['segments'][0]
    assert (segment['ospfCost'], segment['costInterface'], segment['sourceInterface']) == (10, 'Vlanif100', 'GE1')
    assert segment['costAssociation'] == 'unique-peer'
    data['ospf'].append({**data['ospf'][0], 'id': 'a-second', 'interface': 'Vlanif200', 'neighborRouterId': '10.0.0.2', 'neighborIp': '172.20.1.2', 'localIp': '172.20.1.1', 'cost': 200})
    assert DependencyGraph(data, NOW).paths['A:path1']['segments'][0]['ospfCost'] is None
    data['paths'][0]['hops'][0]['nextHop'] = '172.20.0.2'
    segment = DependencyGraph(data, NOW).paths['A:path1']['segments'][0]
    assert segment['ospfCost'] == 10 and segment['costAssociation'] == 'next-hop'
    data['paths'][0]['hops'][0]['nextHop'] = '172.20.2.2'
    assert DependencyGraph(data, NOW).paths['A:path1']['segments'][0]['ospfCost'] is None


def test_duplicate_or_stale_subnet_owner_does_not_create_a_logical_link():
    data = vlanifs()
    data['interfaces'].append({**data['interfaces'][1], 'id': 'C:Vlanif100', 'nodeId': 'C'})
    assert 'targetNode' not in DependencyGraph(data, NOW).ospf[0]
    data = vlanifs()
    data['interfaces'][1]['observedAt'] = NOW - 600000
    assert 'targetNode' not in DependencyGraph(data, NOW).ospf[0]


def test_pw_policy_override_survives_out_interface_table_and_reaches_service_path():
    outputs = {'services': 'VSI Name : CLIENTE\nVSI ID : 300\nTunnel Policy Name : TP-DEFAULT\nPeer Ip Address : 10.0.0.3\nVC ID : 300\nTunnel Policy Name : TP-PEER\n',
               'pws': 'CLIENTE 10.0.0.3 300 Tunnel1\n'}
    batch = parse_outputs(Device('A', '192.0.2.1'), outputs, NOW)
    assert batch.tables['services'][0]['tunnelPolicy'] == 'TP-DEFAULT'
    assert batch.tables['pws'][0]['tunnelPolicy'] == 'TP-PEER'
    data = fixture()
    data['services'][0]['tunnelPolicy'] = 'TP-DEFAULT'
    data['pws'][0]['tunnelPolicy'] = 'TP-PEER'
    result = DependencyGraph(data, NOW).service_path('A:VSI300')
    assert result['forward'][0]['tunnelPolicy'] == 'TP-PEER'
    assert result['forward'][0]['policyObservedAt'] == NOW
    data['pws'][0].pop('outInterface')
    result = DependencyGraph(data, NOW).service_path('A:VSI300')
    assert result['pseudowires'][0]['tunnelPolicy'] == 'TP-PEER' and not result['forward']
