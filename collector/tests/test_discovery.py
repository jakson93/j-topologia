import json
import pytest
from fastapi.testclient import TestClient
from jtopology.models import Batch, Device, TABLES
from jtopology.storage import Store
from jtopology.graph import DependencyGraph
from jtopology.huawei import parse_outputs, validate_command
from jtopology.collector import NetworkCollector
from jtopology.api import create_app

NOW=1_791_903_600_000

def fixture():
    """Synthetic topology proving asymmetric paths, never a capture from the user's Huawei."""
    data={table:[] for table in TABLES}
    for i,name in enumerate('ABCD'):
        data['nodes'].append({'id':name,'hostname':name,'routerId':f'10.0.0.{i+1}','observedAt':NOW})
    for name,a,b in [('AB','A','B'),('BC','B','C'),('CD','C','D'),('DA','D','A')]:
        data['links'].append({'id':name,'name':name,'source':a,'target':b,'sourceInterface':'GE1','targetInterface':'GE2','observedAt':NOW})
    for origin,dest,hops,role in [('A','C',['A','B','C'],'primary'),('C','A',['C','D','A'],'backup')]:
        tunnel=f'{origin}:Tunnel1';lsp=f'{origin}:LSP1';pw=f'{origin}:PW300';sid=f'{origin}:VSI300'
        data['services'].append({'id':sid,'name':'CLIENTE-300','localNode':origin,'vsiId':'300','status':'up','observedAt':NOW})
        data['pws'].append({'id':pw,'serviceId':sid,'sourceNode':origin,'peerRouterId':data['nodes'][ord(dest)-65]['routerId'],'vcId':'300','outInterface':'Tunnel1','observedAt':NOW,'dataSource':'cli'})
        data['tunnels'].append({'id':tunnel,'name':'Tunnel1','source':origin,'destination':dest,'observedAt':NOW})
        data['lsps'].append({'id':lsp,'tunnelId':tunnel,'role':role,'active':True,'observedAt':NOW})
        data['paths'].append({'id':f'{origin}:path1','tunnelId':tunnel,'lspId':lsp,'hops':[{'routerId':data['nodes'][ord(h)-65]['routerId']} for h in hops],
            'kind':'observed','observedAt':NOW,'dataSource':'cli'})
    data['ospf']=[{'id':'ospf-ab','localNode':'A','neighborRouterId':'10.0.0.2','interface':'GE1','cost':10,'observedAt':NOW,'dataSource':'snmp'},
        {'id':'ospf-ba','localNode':'B','neighborRouterId':'10.0.0.1','interface':'GE2','cost':100,'observedAt':NOW,'dataSource':'cli'}]
    return data

def test_service_automatic_chain_and_independent_reverse():
    graph=DependencyGraph(fixture(),NOW)
    result=graph.service_path('A:VSI300')
    assert result['asymmetric'] is True
    assert [h['nodeId'] for h in result['forward'][0]['path']['hops']]==['A','B','C']
    assert [h['nodeId'] for h in result['reverse'][0]['path']['hops']]==['C','D','A']
    assert result['reverse'][0]['lspRole']=='backup'
    assert result['forward'][0]['path']['segments'][0]['ospfCost']==10
    assert graph.impact('AB')['serviceIds']==['A:VSI300','C:VSI300']

def test_no_reverse_inference_when_remote_pw_is_missing():
    data=fixture();data['pws']=data['pws'][:1]
    result=DependencyGraph(data,NOW).service_path('A:VSI300')
    assert not result['reverse'] and result['asymmetric'] is None

def test_policy_and_up_tunnel_do_not_prove_service_binding():
    data=fixture();data['pws'][0].pop('outInterface');data['pws'][0]['tunnelPolicy']='TE-POLICY'
    assert not DependencyGraph(data,NOW).service_path('A:VSI300')['forward']

def test_inactive_lsp_and_stale_path_never_confirm_impact():
    data=fixture();data['lsps'][0]['active']=False
    assert not DependencyGraph(data,NOW).service_path('A:VSI300')['forward']
    data=fixture();data['paths'][0]['observedAt']=NOW-600000
    graph=DependencyGraph(data,NOW)
    assert graph.service_path('A:VSI300')['forward'][0]['path']['stale']
    assert graph.impact('AB')['serviceIds']==[]

def test_parallel_links_are_not_guessed_and_router_id_collisions_remain_unresolved():
    data=fixture();data['links'].append({**data['links'][0],'id':'AB2'})
    result=DependencyGraph(data,NOW).service_path('A:VSI300')['forward'][0]['path']
    assert result['actual'] and result['segments'][0]['linkId'] is None
    data['nodes'].append({'id':'duplicate','routerId':'10.0.0.2'})
    assert not DependencyGraph(data,NOW).service_path('A:VSI300')['forward'][0]['path']['actual']

def test_multiple_active_paths_without_invented_percentage():
    data=fixture();data['lsps'].append({**data['lsps'][0],'id':'A:LSP2'})
    data['paths'].append({**data['paths'][0],'id':'A:path2','lspId':'A:LSP2'})
    result=DependencyGraph(data,NOW).service_path('A:VSI300')
    assert result['multipleActivePaths'] and len(result['forward'])==2
    assert all(p['distributionPercent'] is None for p in result['forward'])

def test_cost_history_path_change_dedup_and_field_provenance():
    store=Store()
    first=Batch('A','snmp',NOW);first.add('ospf',{'id':'o','cost':10,'state':'Full'});store.save(first)
    second=Batch('A','snmp',NOW+1000);second.add('ospf',{'id':'o','cost':100});store.save(second);store.save(second)
    third=Batch('A','snmp',NOW+2000);third.add('ospf',{'id':'o','state':'Full'});store.save(third)
    assert len(store.events())==1
    assert len(store.history('ospf','o',0))==2
    row=store.snapshot(NOW+2000)['ospf'][0]
    assert row['cost']==100 and row['provenance']['cost']['observedAt']==NOW+1000
    a=Batch('A','cli',NOW);a.add('paths',{'id':'p','hops':[{'routerId':'1.1.1.1','labelOut':100}]});store.save(a)
    b=Batch('A','cli',NOW+1000);b.add('paths',{'id':'p','hops':[{'routerId':'1.1.1.1','labelOut':200}]});store.save(b)
    assert len(store.events())==1
    c=Batch('A','cli',NOW+2000);c.add('paths',{'id':'p','hops':[{'routerId':'2.2.2.2'}]});store.save(c)
    assert len(store.events())==2

def test_read_only_allowlist_rejects_config_and_injection():
    for command in ['system-view','undo shutdown','display vsi; reboot','display vsi\nshutdown','display current-configuration','commit']:
        with pytest.raises(ValueError):validate_command(command)
    assert validate_command('display vsi verbose')=='display vsi verbose'

def test_parser_documented_formats_and_srv6_segments_not_promoted_to_actual_hops():
    device=Device('A','192.0.2.1',site='ALTAMIRA')
    outputs={'identity':'Huawei S6730-H VRP Software V200R022C00',
      'ospf':"OSPF Process 1 with Router ID 10.0.0.1\nArea 0.0.0.0 interface 192.0.2.1(GE1)'s neighbors\nRouter ID: 10.0.0.2      Address: 192.0.2.2\nState: Full  Mode: Nbr\n",
      'cost':'OSPF Process 1 with Router ID 10.0.0.1\nArea: 0.0.0.0\nGE1 192.0.2.1 P2P P-2-P 20 1\n',
      'tunnels':'Tunnel Name : Tunnel1\nActive LSP : Primary LSP\nSession ID : 1\nIngress LSR ID : 10.0.0.1    Egress LSR ID: 10.0.0.3\nAdmin State : UP    Oper State : UP\nPrimary LSP State : UP\nMain LSP State : READY    LSP ID : 3\n',
      'paths':'Tunnel Interface Name : Tunnel1\nLsp ID : 10.0.0.1 :1 :3\nHop Information\nHop 0 10.0.0.1\nHop 1 10.0.0.2\nHop 2 10.0.0.3\n',
      'services':'VSI Name : CLIENTE-300\nVSI ID : 300\nVSI State : up\nPeer Ip Address : 10.0.0.3\nVC ID : 300\nPW State : up\nOut Interface : Tunnel1\n'}
    batch=parse_outputs(device,outputs,NOW)
    assert batch.tables['nodes'][0]['model']=='S6730-H'
    assert batch.tables['ospf'][0]['cost']==20
    assert batch.tables['tunnels'][0]['primaryLsp']==batch.tables['paths'][0]['lspId']
    assert batch.tables['bindings'][0]['tunnelId']=='A:Tunnel1'
    sr=parse_outputs(device,{'paths':'Tunnel Interface Name : Tunnel1\nLsp ID : 10.0.0.1 :1 :3\nHop 0 Label 330 000 NAI 192.0.2.2'},NOW)
    assert not sr.tables.get('paths') and sr.warnings

def test_failed_discovery_does_not_erase_facts_or_leak_secrets():
    store=Store();batch=Batch('A','snmp',NOW);batch.add('nodes',{'id':'A','hostname':'A'});store.save(batch)
    class Broken:
        source='snmp'
        def collect(self,*args):raise RuntimeError('PASSWORD_SHOULD_NOT_LEAK')
    collector=NetworkCollector(store,[Device('A','192.0.2.1',snmp={'version':'3'})],drivers=[Broken()])
    assert collector.discoverDevice('A',True)['status']=='incomplete'
    assert store.snapshot()['nodes'][0]['hostname']=='A'
    assert 'PASSWORD_SHOULD_NOT_LEAK' not in json.dumps(store.logs())

def test_counter_rates_ignore_wrap_and_reset():
    store=Store();collector=NetworkCollector(store,[])
    first=Batch('A','snmp',NOW);first.add('interfaces',{'id':'A:GE1','rxOctets':1000,'txOctets':1000});store.save(first)
    second=Batch('A','snmp',NOW+1000);second.add('interfaces',{'id':'A:GE1','rxOctets':3000,'txOctets':500});collector._counter_rates(second)
    assert second.tables['interfaces'][0]['rxBps']==16000
    assert second.tables['interfaces'][0]['txBps'] is None

def test_api_separates_read_and_admin_tokens_and_refuses_ambiguous_vsi_name():
    store=Store()
    for name,rows in fixture().items():
        b=Batch('A','fixture',NOW)
        for row in rows:b.add(name,row)
        store.save(b)
    collector=NetworkCollector(store,[])
    app=create_app(store,collector,'r'*32,'a'*32,False)
    with TestClient(app) as client:
        assert client.get('/health').status_code==200
        assert client.get('/snapshot').status_code==401
        assert client.get('/snapshot',headers={'Authorization':'Bearer '+'r'*32}).status_code==200
        assert client.post('/discover/network',headers={'Authorization':'Bearer '+'r'*32}).status_code==401
        assert client.post('/discover/network',headers={'Authorization':'Bearer '+'a'*32}).status_code==200
        assert client.get('/service-path/CLIENTE-300',headers={'Authorization':'Bearer '+'r'*32}).status_code==409

def test_physical_discovery_requires_reciprocal_lldp_and_correct_interfaces():
    data=fixture();data['links']=[]
    data['interfaces']=[{'id':'A:GE1','name':'GE1','nodeId':'A','physicalStatus':1,'observedAt':NOW,'lldpPeers':[{'hostname':'B','interface':'GE2'}]},
        {'id':'B:GE2','name':'GE2','nodeId':'B','physicalStatus':2,'observedAt':NOW,'lldpPeers':[]}]
    assert not DependencyGraph(data,NOW).links
    data['interfaces'][1]['lldpPeers']=[{'hostname':'A','interface':'GE1'}]
    graph=DependencyGraph(data,NOW)
    assert len(graph.links)==1 and next(iter(graph.links.values()))['physicalStatus']=='down'

def test_ospf_cost_is_directional_and_same_router_hops_do_not_imply_physical_symmetry():
    data=fixture();graph=DependencyGraph(data,NOW)
    assert graph.paths['A:path1']['segments'][0]['ospfCost']==10
    data['links']=[];data['paths'][1]['hops']=[{'routerId':f'10.0.0.{n}'} for n in [3,2,1]]
    result=DependencyGraph(data,NOW).service_path('A:VSI300')
    assert result['asymmetric'] is None
    assert result['reverse'][0]['path']['segments'][1]['ospfCost']==100
