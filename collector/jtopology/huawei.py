"""Conservative Huawei VRP text adapters. Unknown output is a diagnostic, never success.

The base profile covers documented key/value and table formats. It must be validated
against the operator's VRP output before production; SR segment lists are NOT full RROs.
"""
import re
import ipaddress
from .models import Batch, Device, stable

COMMANDS = {
    'identity': 'display version', 'interfaces': 'display ip interface brief',
    'ospf': 'display ospf peer', 'cost': 'display ospf interface',
    'tunnels': 'display mpls te tunnel-interface', 'paths': 'display mpls te tunnel path',
    'services': 'display vsi verbose', 'pws': 'display vsi pw out-interface',
    'lsps': 'display mpls lsp verbose',
}

def validate_command(command: str) -> str:
    if command not in COMMANDS.values():
        raise ValueError('Command outside fixed read-only allowlist')
    return command

def unsupported(output: str) -> bool:
    return bool(re.search(r'(unrecognized command|incomplete command|wrong parameter|unknown command|permission denied|error:)', output, re.I))

def kv(block: str, key: str) -> str | None:
    match = re.search(r'(?:^|\s)\**' + re.escape(key) + r'\s*:\s*(.*?)(?=\s{2,}[A-Za-z][\w /()-]*\s*:|\n|$)', block, re.I)
    return match[1].strip() if match else None

def ip(value: str | None) -> str | None:
    if not value: return None
    try: return str(ipaddress.ip_address(value))
    except ValueError: return None

def parse_outputs(device: Device, outputs: dict[str,str], observed_at: int) -> Batch:
    batch=Batch(device.id,'cli',observed_at)
    identity=outputs.get('identity','')
    if identity:
        if 'huawei' not in identity.lower() or not re.search(device.vrp_pattern,identity,re.I):
            raise ValueError('Manufacturer or VRP release not covered by the profile')
        model=re.search(r'\b(S\d{4}[\w-]*)\b',identity,re.I)
        version=re.search(r'\b(V\d{3}R\d{3}C\d{2}[\w]*)\b',identity)
        batch.add('nodes',{'id':device.id,'hostname':device.id,'site':device.site or device.id,'ip':device.host,
            'vendor':'Huawei','model':model[1] if model else None,'vrp':version[1] if version else None})
    for kind in COMMANDS:
        output=outputs.get(kind,'')
        if not output:continue
        if unsupported(output):
            batch.warnings.append(f'{kind}: unsupported command or insufficient read permission'); continue
        if '--More--' in output or '---- More ----' in output:
            batch.warnings.append(f'{kind}: truncated output; no facts accepted'); continue
        if kind=='interfaces':
            count=0
            for match in re.finditer(r'^\s*(\S+)\s+(\d+\.\d+\.\d+\.\d+)/(\d+)\s+(up|down|\*down)\s+(up|down)\b',output,re.M|re.I):
                name,address,prefix,physical,protocol=match.groups();count+=1
                batch.add('interfaces',{'id':stable(device.id,name),'nodeId':device.id,'name':name,'ipv4':[f'{address}/{prefix}'],
                    'physicalStatus':physical,'protocolStatus':protocol,'logical':name.lower().startswith(('vlanif','eth-trunk','loopback','tunnel'))})
            if output.strip() and not count: batch.warnings.append('interfaces: no recognized rows')
        elif kind=='ospf':
            router=re.search(r'OSPF Process\s+(\d+)\s+with Router ID\s+(\S+)',output,re.I)
            if router:
                batch.add('nodes',{'id':device.id,'hostname':device.id,'site':device.site or device.id,'routerId':router[2]})
            area=None;interface=None;local_ip=None;count=0
            for line in output.splitlines():
                header=re.search(r'Area\s+(\S+)\s+interface\s+(\S+?)\(([^)]+)\)',line,re.I)
                if header: area,local_ip,interface=header.groups()
                match=re.search(r'Router ID:\s*(\S+)\s+Address:\s*(\S+)',line,re.I)
                if match:
                    peer,address=match.groups();state='Unknown'
                    tail=output[output.find(line)+len(line):]
                    s=re.match(r'\s*State:\s*(\S+)',tail,re.I)
                    if s: state=s[1].replace('2-Way','2-Way')
                    if interface and area:
                        batch.add('ospf',{'id':stable(device.id,f'ospf:{router[1] if router else "unknown"}:{interface}:{peer}'),
                            'localNode':device.id,'localRouterId':router[2] if router else None,'process':router[1] if router else None,
                            'neighborRouterId':peer,'neighborIp':address,'interface':interface,'localIp':local_ip,'area':area,'state':state});count+=1
            if output.strip() and not count: batch.warnings.append('ospf: no recognized neighbors; inventory not cleared')
        elif kind=='cost':
            process='unknown';area='unknown';costs={}
            for line in output.splitlines():
                p=re.search(r'OSPF Process\s+(\d+)',line,re.I)
                if p: process=p[1]
                a=re.search(r'Area:\s*(\S+)',line,re.I)
                if a: area=a[1]
                m=re.match(r'\s*(\S+)\s+(\d+\.\d+\.\d+\.\d+)\s+(Broadcast|P2P|P2MP|NBMA)\s+(\S+)\s+(\d+)\s+\d+',line,re.I)
                if m: costs[m[1]]={'cost':int(m[5]),'networkType':m[3],'process':process,'area':area,'localIp':m[2]}
            for row in batch.tables.get('ospf',[]):
                if row['interface'] in costs: row.update(costs[row['interface']])
            if output.strip() and not costs: batch.warnings.append('cost: no recognized interface cost table')
        elif kind=='tunnels':
            blocks=re.split(r'(?=^\s*(?:Tunnel Name\s*:|Tunnel\d[\w/.-]*\s*$))',output,flags=re.M)
            count=0
            for block in blocks:
                name=kv(block,'Tunnel Name') or (re.search(r'^\s*(Tunnel\d[\w/.-]*)\s*$',block,re.M)[1] if re.search(r'^\s*(Tunnel\d[\w/.-]*)\s*$',block,re.M) else None)
                ingress=ip(kv(block,'Ingress LSR ID'));egress=ip(kv(block,'Egress LSR ID'))
                if not name or not ingress or not egress: continue
                active=kv(block,'Active LSP'); active_path='primary' if active and 'primary' in active.lower() else 'backup' if active and re.search('backup|standby',active,re.I) else 'unknown'
                lsp_sections=re.findall(r'(Primary|Hot-Standby|Backup) LSP State\s*:\s*(\S+)(.*?)(?=\n\s*(?:Primary|Hot-Standby|Backup) LSP State|\Z)',block,re.S|re.I)
                lsp_ids={}
                for role,state,section in lsp_sections:
                    identifier=kv(section,'LSP ID');role_key='primary' if role.lower()=='primary' else 'backup'
                    if identifier:
                        lid=stable(device.id,f'lsp:{ingress}:{kv(block,"Session ID")}:{identifier}');lsp_ids[role_key]=lid
                        batch.add('lsps',{'id':lid,'tunnelId':stable(device.id,name),'role':role_key,'state':state,
                            'active':active_path==role_key,'rawLspId':identifier,'sourceRouterId':ingress,'destinationRouterId':egress})
                batch.add('tunnels',{'id':stable(device.id,name),'name':name,'source':device.id,'destinationRouterId':egress,'ingressRouterId':ingress,
                    'adminStatus':kv(block,'Admin State'),'operStatus':kv(block,'Oper State'),'activePath':active_path,
                    'primaryLsp':lsp_ids.get('primary'),'backupLsp':lsp_ids.get('backup'),'signaling':kv(block,'Signaling Protocol'),
                    'sessionId':kv(block,'Session ID'),'tunnelToken':kv(block,'Tunnel ID')});count+=1
            if output.strip() and not count: batch.warnings.append('tunnels: no recognized tunnel records')
        elif kind=='paths':
            count=0
            for block in re.split(r'(?=Tunnel Interface Name\s*:)',output):
                name=kv(block,'Tunnel Interface Name');lsp=kv(block,'Lsp ID')
                if not name or not lsp: continue
                # SR NAI/labels may describe segments instead of every transit hop.
                if re.search(r'\bNAI\b',block,re.I):
                    batch.warnings.append(f'paths/{name}: segment list is not a complete actual hop record');continue
                hops=[]
                for index,address in re.findall(r'^\s*Hop\s+(\d+)\s+(\d+\.\d+\.\d+\.\d+)(?:\s+(?:Label|InLabel|OutLabel)\b[^\n]*)?\s*$',block,re.M|re.I):
                    if ip(address): hops.append({'hopIndex':int(index),'routerId':address})
                if not hops or [h['hopIndex'] for h in hops]!=list(range(len(hops))):
                    batch.warnings.append(f'paths/{name}: missing or unordered hop records');continue
                lid=stable(device.id,'lsp:'+re.sub(r'\s+','',lsp))
                batch.add('paths',{'id':stable(device.id,f'path:{name}:{re.sub(r"\s+","",lsp)}'),'tunnelId':stable(device.id,name),'lspId':lid,'rawLspKey':re.sub(r'\s+','',lsp),
                    'hops':hops,'kind':'observed','command':COMMANDS['paths']});count+=1
            if output.strip() and not count: batch.warnings.append('paths: no complete RRO path parsed')
        elif kind=='services':
            count=0
            for block in re.split(r'(?=^\s*\**VSI Name\s*:)',output,flags=re.M|re.I):
                name=kv(block,'VSI Name')
                if not name: continue
                sid=stable(device.id,f'vsi:{name}');vsi_id=kv(block,'VSI ID')
                batch.add('services',{'id':sid,'name':name,'localNode':device.id,'vsiId':vsi_id,'status':kv(block,'VSI State'),
                    'encapsulation':kv(block,'Encapsulation Type'),'tunnelPolicy':kv(block,'Tunnel Policy Name')});count+=1
                for pwblock in re.split(r'(?=Peer Ip Address\s*:|Peer IP\s*:)',block,flags=re.I)[1:]:
                    peer=ip(kv(pwblock,'Peer Ip Address') or kv(pwblock,'Peer IP'))
                    vc=kv(pwblock,'VC ID')
                    if not peer or not vc: continue
                    batch.add('pws',{'id':stable(device.id,f'pw:{name}:{peer}:{vc}'),'serviceId':sid,'sourceNode':device.id,
                        'peerRouterId':peer,'vcId':vc,'status':kv(pwblock,'PW State') or kv(pwblock,'State'),
                        'tunnelToken':kv(pwblock,'Tunnel ID'),'outInterface':kv(pwblock,'Out Interface') or kv(pwblock,'OutInterface'),
                        'tunnelPolicy':kv(pwblock,'Tunnel Policy Name') or kv(block,'Tunnel Policy Name')})
            if output.strip() and not count: batch.warnings.append('services: no recognized VSI records')
        elif kind=='pws':
            # The vcid column supplies the actual PW ID; a VSI ID is not assumed to be its VC ID.
            for name,peer,vc,out in re.findall(r'^\s*(\S+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s+([^\n]+)$',output,re.M):
                sid=stable(device.id,f'vsi:{name}')
                if not any(s['id']==sid for s in batch.tables.get('services',[])):continue
                normalized=re.sub(r'^(Tunnel)\s+',r'\1',out.strip(),flags=re.I)
                batch.add('pws',{'id':stable(device.id,f'pw:{name}:{peer}:{vc}'),'serviceId':sid,'sourceNode':device.id,
                    'peerRouterId':peer,'vcId':vc,'outInterface':normalized})
            if output.strip() and not batch.tables.get('pws'): batch.warnings.append('pws: output could not be correlated to parsed VSI peers')
        elif kind=='lsps' and output.strip():
            count=0
            for block in re.split(r'(?=^\s*SessionID\s*:)',output,flags=re.M):
                ingress=kv(block,'IngressLsrID');session=kv(block,'SessionID');local_id=kv(block,'LocalLspID');name=kv(block,'Tunnel-Interface')
                if not ip(ingress) or not session or not local_id:continue
                key=f'{ingress}:{session}:{local_id}'
                batch.add('lsps',{'id':stable(device.id,'lsp:'+key),'rawLspKey':key,'nodeId':device.id,
                    'tunnelId':stable(device.id,re.sub(r'^(Tunnel)\s+',r'\1',name)) if name and name.startswith('Tunnel') else None,
                    'nextHop':kv(block,'Nexthop'),'labelIn':kv(block,'In-Label'),'labelOut':kv(block,'Out-Label'),
                    'incomingInterface':kv(block,'In-Interface'),'outgoingInterface':kv(block,'Out-Interface'),'lsrRole':kv(block,'LsrType')});count+=1
            if not count:batch.warnings.append('lsps: unsupported LFIB format; labels/interfaces remain incomplete')
    # A successfully read PW out-interface is a binding; a configured policy alone is not.
    for pw in batch.tables.get('pws',[]):
        out=pw.get('outInterface','') or ''
        if re.fullmatch(r'Tunnel[\w/.-]+',out,re.I):
            tid=stable(device.id,out)
            if any(t['id']==tid for t in batch.tables.get('tunnels',[])):
                batch.add('bindings',{'id':stable(device.id,f'binding:{pw["id"]}:{tid}'),'pwId':pw['id'],'tunnelId':tid,'active':True})
    return batch
