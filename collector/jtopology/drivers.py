"""Protocol adapters with bounded reads and server-only secret references."""
import asyncio
import ipaddress
import os
import re
import time
from pathlib import Path
from defusedxml import ElementTree as ET
from .models import Batch, Device, now_ms, stable
from .huawei import COMMANDS, parse_outputs, unsupported, validate_command

class CollectionError(RuntimeError):
    pass

def secret(config: dict, name: str, required: bool = False) -> str | None:
    # The device configuration contains environment variable names or Docker secret paths, not secret values.
    value=None
    if config.get(name+'_env'): value=os.environ.get(config[name+'_env'])
    elif config.get(name+'_file'): value=Path(config[name+'_file']).read_text().strip()
    if required and not value: raise CollectionError(f'Missing secret reference: {name}')
    return value

class CliDriver:
    source='cli'
    def __init__(self):
        self.identity_cache={}
        self.unsupported_cache={}
    def collect(self, device: Device, groups: set[str]) -> Batch:
        import paramiko
        if not device.cli_enabled: raise CollectionError('CLI profile not enabled for this device')
        client=paramiko.SSHClient()
        client.load_system_host_keys()
        if device.ssh.get('known_hosts'): client.load_host_keys(device.ssh['known_hosts'])
        client.set_missing_host_key_policy(paramiko.RejectPolicy())
        config=device.ssh
        try:
            client.connect(device.host,port=int(config.get('port',22)),username=config['username'],
                password=secret(config,'password'),key_filename=config.get('key_file'),
                timeout=10,banner_timeout=10,auth_timeout=10,allow_agent=False,look_for_keys=False)
            outputs={}
            shell=None
            def read_shell(command):
                nonlocal shell
                if shell is None:
                    shell=client.invoke_shell(width=160,height=200)
                    shell.settimeout(2)
                    read_prompt(False)
                shell.sendall(command+'\n')
                return read_prompt(True)
            def read_prompt(paging):
                deadline=time.monotonic()+25;parts=[];total=0
                while time.monotonic()<deadline:
                    if not shell.recv_ready():time.sleep(.05);continue
                    chunk=shell.recv(65536)
                    if not chunk:raise CollectionError('SSH shell closed')
                    total+=len(chunk)
                    if total>4*1024*1024:raise CollectionError('Output exceeded collection bound')
                    text=chunk.decode('utf8',errors='replace');parts.append(text)
                    if paging and re.search(r'-+\s*More\s*-+',text,re.I):shell.sendall(' ')
                    joined=''.join(parts)
                    cleaned=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',joined).replace('\x08','')
                    if re.search(r'(?:^|\n)[<\[][^\r\n<>\[\]]+[>\]]\s*$',cleaned):return re.sub(r'-+\s*More\s*-+','',cleaned,flags=re.I)
                raise CollectionError('SSH response timeout')
            def read(command):
                validate_command(command)
                if shell is not None or config.get('transport')=='shell':return read_shell(command)
                try:_,stdout,stderr=client.exec_command(command,timeout=25)
                except paramiko.SSHException:return read_shell(command)
                stdout.channel.settimeout(25)
                # Huawei versions without exec support are rejected, not driven through a configuration shell.
                chunks=[];total=0
                while True:
                    chunk=stdout.read(65536)
                    if not chunk: break
                    total+=len(chunk)
                    if total>4*1024*1024: raise CollectionError('Output exceeded collection bound')
                    chunks.append(chunk)
                output=b''.join(chunks).decode('utf-8',errors='replace')
                if stdout.channel.recv_exit_status()!=0 and not unsupported(output):raise CollectionError('Read-only command rejected')
                return output
            cached=self.identity_cache.get(device.id)
            cached_identity=bool(cached and now_ms()-cached[0]<1800000 and 'identity' not in groups)
            outputs['identity']=cached[1] if cached_identity else read(COMMANDS['identity'])
            if 'huawei' not in outputs['identity'].lower() or not re.search(device.vrp_pattern,outputs['identity'],re.I):
                raise CollectionError('Unsupported vendor or VRP profile')
            if not cached_identity:self.identity_cache[device.id]=(now_ms(),outputs['identity'])
            errors=[]
            for group,command in COMMANDS.items():
                if group=='identity' or group not in groups: continue
                if now_ms()-self.unsupported_cache.get((device.id,group),-1e15)<1800000:continue
                try:outputs[group]=read(command)
                except Exception as exc:
                    errors.append(f'{group}: read failed ({type(exc).__name__}); other modules preserved');continue
                if unsupported(outputs[group]):self.unsupported_cache[(device.id,group)]=now_ms()
            batch=parse_outputs(device,outputs,now_ms())
            batch.warnings.extend(errors)
            if cached_identity:
                for row in batch.tables.get('nodes',[]):
                    for field in ['model','vrp','vendor','ip','hostname','site']:row.pop(field,None)
            return batch
        except (CollectionError,KeyError): raise
        except Exception as exc: raise CollectionError(f'SSH read failed ({type(exc).__name__})') from None
        finally: client.close()

class NetconfDriver:
    source='netconf'
    def collect(self, device: Device, groups: set[str]) -> Batch:
        from ncclient import manager
        config=device.netconf
        if not config: raise CollectionError('NETCONF not configured')
        batch=Batch(device.id,'netconf',now_ms())
        try:
            with manager.connect(host=device.host,port=int(config.get('port',830)),username=config['username'],
                password=secret(config,'password'),key_filename=config.get('key_file'),
                hostkey_verify=True,allow_agent=False,look_for_keys=False,timeout=20,device_params={'name':'default'}) as session:
                capabilities=[str(c) for c in session.server_capabilities]
                batch.add('collector',{'id':stable(device.id,'netconf'),'protocol':'netconf','status':'ok','capabilities':capabilities})
                profiles=list(device.yang_profiles)
                if any('ietf-interfaces' in c for c in capabilities):
                    profiles.append({'group':'interfaces','capability':'ietf-interfaces','filter':'<interfaces-state xmlns="urn:ietf:params:xml:ns:yang:ietf-interfaces"/>','builtin':'ietf-interfaces'})
                for profile in profiles:
                    if profile['group'] not in groups or not any(profile['capability'] in c for c in capabilities): continue
                    # Parsing validates a subtree, never accepts an arbitrary user RPC.
                    filter_xml=ET.fromstring(profile['filter'])
                    if any(element.tag.split('}')[-1] in {'rpc','edit-config','copy-config','delete-config','commit','action','exec'} for element in filter_xml.iter()):
                        raise CollectionError('Only NETCONF get subtree filters are accepted')
                    reply=session.get(filter=('subtree',profile['filter']))
                    if len(reply.xml)>4*1024*1024:raise CollectionError('NETCONF reply exceeded collection bound')
                    root=ET.fromstring(reply.xml)
                    if profile.get('builtin')=='ietf-interfaces':
                        for interface in root.findall('.//{urn:ietf:params:xml:ns:yang:ietf-interfaces}interface'):
                            def field(name): return interface.findtext('{urn:ietf:params:xml:ns:yang:ietf-interfaces}'+name)
                            name=field('name')
                            if name: batch.add('interfaces',{'id':stable(device.id,name),'nodeId':device.id,'name':name,'physicalStatus':field('oper-status'),'ifIndex':field('if-index')})
                    else:
                        # Version-specific declarative XPath mappings. No code eval and no assumed Huawei schema.
                        for element in root.findall(profile['row_path']):
                            def extract(element,mapping):
                                result={}
                                for key,spec in mapping.items():
                                    if isinstance(spec,str):result[key]=element.findtext(spec)
                                    elif isinstance(spec,dict) and 'list' in spec:
                                        result[key]=[extract(child,spec.get('fields',{})) for child in element.findall(spec['list'])]
                                    elif isinstance(spec,dict):
                                        value=element.findtext(spec['path'])
                                        if value is not None:
                                            convert={'int':int,'float':float,'bool':lambda v:v.lower()=='true','json':__import__('json').loads}.get(spec.get('type'),str)
                                            result[key]=convert(value)
                                return result
                            row=extract(element,profile.get('fields',{}))
                            raw_id=row.get('id')
                            if not raw_id: batch.warnings.append('NETCONF row missing identity');continue
                            row['id']=stable(device.id,raw_id)
                            for key in profile.get('device_scoped_fields',[]):
                                if row.get(key): row[key]=stable(device.id,row[key])
                            row.update(profile.get('constants',{}))
                            if profile['table']=='nodes':row['id']=device.id
                            if profile['table'] in {'services','pws','interfaces','ospf'}:
                                row.setdefault('localNode' if profile['table']=='ospf' or profile['table']=='services' else 'sourceNode' if profile['table']=='pws' else 'nodeId',device.id)
                            batch.add(profile['table'],row)
                if not device.yang_profiles: batch.warnings.append('Huawei service/path YANG mappings not validated; CLI fallback required for these domains')
                return batch
        except CollectionError: raise
        except Exception as exc: raise CollectionError(f'NETCONF get failed ({type(exc).__name__})') from None

class SnmpDriver:
    source='snmp'
    def collect(self, device: Device, groups: set[str]) -> Batch:
        return asyncio.run(self._collect(device,groups))

    async def _collect(self, device, groups):
        from pysnmp.hlapi.v3arch.asyncio import (SnmpEngine, CommunityData, UsmUserData, UdpTransportTarget, Udp6TransportTarget,
            ContextData, ObjectIdentity, ObjectType, get_cmd, bulk_walk_cmd, usmHMACSHAAuthProtocol, usmAesCfb128Protocol)
        config=device.snmp
        if not config: raise CollectionError('SNMP not configured')
        engine=SnmpEngine();batch=Batch(device.id,'snmp',now_ms());tables={}
        auth=UsmUserData(config['username'],secret(config,'auth',True),secret(config,'priv',True),authProtocol=usmHMACSHAAuthProtocol,privProtocol=usmAesCfb128Protocol) if config.get('version')=='3' else CommunityData(secret(config,'community',True),mpModel=1)
        target_class=Udp6TransportTarget if ':' in device.host else UdpTransportTarget
        target=await target_class.create((device.host,int(config.get('port',161))),timeout=2,retries=1)
        async def walk(name,oid):
            data={}
            async for error,status,_,values in bulk_walk_cmd(engine,auth,target,ContextData(),0,20,ObjectType(ObjectIdentity(oid)),lexicographicMode=False,lookupMib=False,maxRows=10000):
                if error or status: batch.warnings.append(f'SNMP {name}: unavailable or timed out');break
                for key,value in values:
                    key=key.prettyPrint()
                    if not key.startswith(oid+'.'):continue
                    if value.__class__.__name__ in {'NoSuchObject','NoSuchInstance','EndOfMibView'}:continue
                    data[key[len(oid)+1:]]=value.prettyPrint()
            tables[name]=data
            return data
        try:
            error,status,_,values=await get_cmd(engine,auth,target,ContextData(),ObjectType(ObjectIdentity('1.3.6.1.2.1.1.1.0')),ObjectType(ObjectIdentity('1.3.6.1.2.1.1.5.0')),ObjectType(ObjectIdentity('1.3.6.1.2.1.14.1.1.0')),lookupMib=False)
            if error or status: raise CollectionError('SNMP identification unavailable')
            descr,hostname,router=[v.prettyPrint() for _,v in values]
            batch.add('nodes',{'id':device.id,'hostname':hostname,'site':device.site or hostname,'ip':device.host,'vendor':'Huawei' if 'huawei' in descr.lower() else 'unknown',
                'model':(re.search(r'\bS\d{4}[\w-]*',descr,re.I)[0] if re.search(r'\bS\d{4}[\w-]*',descr,re.I) else None),
                'routerId':router if re.fullmatch(r'\d+\.\d+\.\d+\.\d+',router) else None,'snmpStatus':'up'})
            if groups & {'interfaces','ospf','cost'}:
                await walk('ifName','1.3.6.1.2.1.31.1.1.1.1')
                await walk('ipIfIndex','1.3.6.1.2.1.4.20.1.2');await walk('ipMask','1.3.6.1.2.1.4.20.1.3')
            if 'interfaces' in groups:
                for name,oid in {'ifStatus':'1.3.6.1.2.1.2.2.1.8','ifSpeed':'1.3.6.1.2.1.31.1.1.1.15','rxOctets':'1.3.6.1.2.1.31.1.1.1.6','txOctets':'1.3.6.1.2.1.31.1.1.1.10',
                    'errors':'1.3.6.1.2.1.2.2.1.14','discards':'1.3.6.1.2.1.2.2.1.13','lldpLocalPort':'1.0.8802.1.1.2.1.3.7.1.3','lldpRemotePort':'1.0.8802.1.1.2.1.4.1.1.7','lldpRemoteName':'1.0.8802.1.1.2.1.4.1.1.9'}.items(): await walk(name,oid)
                for index,name in tables['ifName'].items():
                    addresses=[f'{address}/{tables["ipMask"].get(address,"255.255.255.255")}' for address,idx in tables['ipIfIndex'].items() if idx==index]
                    peers=[{'hostname':remote,'interface':tables['lldpRemotePort'].get(key)} for key,remote in tables['lldpRemoteName'].items()
                        if len(key.split('.'))>=3 and tables['lldpLocalPort'].get(key.split('.')[-2])==name]
                    def number(field):
                        value=tables[field].get(index)
                        return int(value) if value and value.isdigit() else None
                    batch.add('interfaces',{'id':stable(device.id,name),'nodeId':device.id,'name':name,'ifIndex':int(index),'ipv4':addresses,'physicalStatus':number('ifStatus'),
                        'capacityBps':number('ifSpeed')*1000000 if number('ifSpeed') else None,'rxOctets':number('rxOctets'),'txOctets':number('txOctets'),
                        'errorCounter':number('errors'),'discardCounter':number('discards'),'lldpPeers':peers,'logical':name.lower().startswith(('vlanif','eth-trunk','loopback','tunnel'))})
            if groups & {'ospf','cost'}:
                for name,oid in {'nbrRouter':'1.3.6.1.2.1.14.10.1.3','nbrState':'1.3.6.1.2.1.14.10.1.6','ifArea':'1.3.6.1.2.1.14.7.1.3','ifCost':'1.3.6.1.2.1.14.8.1.4'}.items(): await walk(name,oid)
                for index,peer in tables['nbrRouter'].items():
                    neighbor='.'.join(index.split('.')[:4]); matches=[]
                    for address,if_index in tables['ipIfIndex'].items():
                        try:
                            if ipaddress.ip_address(neighbor) in ipaddress.ip_network(f'{address}/{tables["ipMask"].get(address,"255.255.255.255")}',strict=False):matches.append((address,if_index))
                        except ValueError:continue
                    if len(matches)!=1:
                        batch.warnings.append('SNMP neighbor has no unique local interface mapping');continue
                    address,if_index=matches[0];name=tables['ifName'].get(if_index)
                    if not name:continue
                    cost=tables['ifCost'].get(f'{address}.0.0');area=tables['ifArea'].get(f'{address}.0')
                    batch.add('ospf',{'id':stable(device.id,f'ospf:snmp:{name}:{peer}'),'localNode':device.id,'neighborRouterId':peer,'neighborIp':neighbor,'interface':name,
                        'localIp':address,'area':area,'state':tables['nbrState'].get(index),'cost':int(cost) if cost and cost.isdigit() else None})
            return batch
        except CollectionError:raise
        except Exception as exc: raise CollectionError(f'SNMP read failed ({type(exc).__name__})') from None
        finally:engine.close_dispatcher()
