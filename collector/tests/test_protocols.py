import sys
import types
import pytest
from jtopology.drivers import NetconfDriver, CliDriver, CollectionError
from jtopology.models import Batch, Device
from jtopology.storage import Store
from jtopology.huawei import parse_outputs

def test_netconf_uses_get_only_and_accepts_operational_interface_mapping(monkeypatch):
    calls=[]
    class Session:
        server_capabilities=['urn:ietf:params:xml:ns:yang:ietf-interfaces']
        def __enter__(self):return self
        def __exit__(self,*args):pass
        def get(self,filter):
            calls.append(filter)
            return types.SimpleNamespace(xml='<rpc-reply><data><interfaces-state xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces"><interface><name>GE1</name><oper-status>up</oper-status><if-index>1</if-index></interface></interfaces-state></data></rpc-reply>')
    import ncclient.manager
    monkeypatch.setattr(ncclient.manager,'connect',lambda **kwargs:Session())
    batch=NetconfDriver().collect(Device('A','192.0.2.1',netconf={'username':'monitor'}),{'interfaces'})
    assert batch.tables['interfaces'][0]['name']=='GE1'
    assert len(calls)==1 and calls[0][0]=='subtree'
    bad=Device('A','192.0.2.1',netconf={'username':'monitor'},yang_profiles=[{'group':'paths','capability':'ietf-interfaces','filter':'<edit-config/>','table':'paths'}])
    with pytest.raises(CollectionError):NetconfDriver().collect(bad,{'paths'})
    assert len(calls)==1

def test_vrp_5170_and_pw_vcid_from_out_interface_are_supported_without_assuming_vsi_id():
    outputs={'identity':'Huawei S6730-H VRP Software Version 5.170',
        'services':'***VSI Name : CLIENTE\nVSI ID : 999\nVSI State : up\n',
        'pws':'Vsi Name  peer  vcid  interface\nCLIENTE 10.0.0.2 300 Tunnel 1\n'}
    batch=parse_outputs(Device('A','192.0.2.1'),outputs,1000)
    assert batch.tables['pws'][0]['vcId']=='300'
    assert batch.tables['pws'][0]['outInterface']=='Tunnel1'
    assert batch.tables['services'][0]['vsiId']=='999'

def test_source_priority_is_per_field_and_fresh_cli_beats_old_netconf_path():
    store=Store()
    first=Batch('A','netconf',1000);first.add('paths',{'id':'p','hops':[{'routerId':'10.0.0.1'}]});store.save(first)
    refresh=Batch('A','netconf',601000);refresh.add('paths',{'id':'p','status':'up'});store.save(refresh)
    fallback=Batch('A','cli',601000);fallback.add('paths',{'id':'p','hops':[{'routerId':'10.0.0.2'}]});store.save(fallback)
    row=store.snapshot(601000)['paths'][0]
    assert row['hops'][0]['routerId']=='10.0.0.2'
    assert row['provenance']['hops']['dataSource']=='cli'

def test_truncated_and_unknown_cli_responses_do_not_clear_or_invent_inventory():
    batch=parse_outputs(Device('A','192.0.2.1'),{'paths':'---- More ----','services':'Unrecognized command'},1000)
    assert not batch.tables and len(batch.warnings)==2

def test_scheduler_only_falls_back_for_missing_domains_and_caches_polling():
    from jtopology.collector import NetworkCollector
    calls=[]
    class Fake:
        def __init__(self,source):self.source=source
        def collect(self,device,groups):
            calls.append((self.source,set(groups)));b=Batch(device.id,self.source,1000)
            if self.source=='netconf':b.add('interfaces',{'id':'A:GE1','name':'GE1'})
            if self.source=='snmp':
                b.add('nodes',{'id':'A','hostname':'A'})
                b.add('ospf',{'id':'o','cost':10,'state':'Full'})
            return b
    collector=NetworkCollector(Store(),[Device('A','192.0.2.1',snmp={'version':'3'},netconf={'username':'monitor'},ssh={'username':'monitor'},cli_enabled=True)],drivers=[Fake('netconf'),Fake('snmp'),Fake('cli')])
    collector.discoverDevice('A',True)
    assert 'interfaces' not in calls[1][1]
    assert not {'identity','interfaces','ospf','cost'} & calls[2][1]
    assert collector.discoverDevice('A')['status']=='cached'

def test_ssh_transport_retains_host_key_verification_and_only_fixed_display_commands(monkeypatch):
    import paramiko
    calls=[]
    class Channel:
        def settimeout(self,*args):pass
        def recv_exit_status(self):return 0
    class Output:
        def __init__(self,text):self.value=text.encode();self.channel=Channel()
        def read(self,size):data=self.value;self.value=b'';return data
    class Client:
        def load_system_host_keys(self):calls.append('known_hosts')
        def set_missing_host_key_policy(self,policy):assert isinstance(policy,paramiko.RejectPolicy)
        def connect(self,*args,**kwargs):pass
        def exec_command(self,command,**kwargs):
            calls.append(command)
            if command=='display vsi verbose':text='Unrecognized command'
            elif command=='display version':text='Huawei S6730-H Software Version 5.170'
            else:text='Tunnel Interface Name : Tunnel1\nLsp ID : 10.0.0.1 :1 :3\nHop 0 10.0.0.1\nHop 1 10.0.0.2\n'
            return None,Output(text),Output('')
        def close(self):pass
    monkeypatch.setattr(paramiko,'SSHClient',Client)
    driver=CliDriver();device=Device('A','192.0.2.1',ssh={'username':'monitor'},cli_enabled=True)
    batch=driver.collect(device,{'paths','services'})
    assert batch.tables['paths'] and batch.warnings
    assert all(c=='known_hosts' or c.startswith('display ') for c in calls)
    calls.clear();driver.collect(device,{'paths','services'})
    assert 'display version' not in calls and 'display vsi verbose' not in calls
