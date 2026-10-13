"""Evidence graph: no OSPF shortest path is substituted for an actual service path."""
import ipaddress
import json
from .models import now_ms

def fresh(row, field, at, age):
    meta=row.get('provenance',{}).get(field,{})
    observed=meta.get('observedAt',row.get('observedAt'))
    return isinstance(observed,(int,float)) and 0<=at-observed<=age

def true(value):return value is True or value=='true' or value==1

class DependencyGraph:
    def __init__(self, snapshot: dict, at: int | None = None, max_age_ms: int = 300000):
        self.at=now_ms() if at is None else at;self.age=max_age_ms;self.data=snapshot;self.issues=[]
        self.nodes={n['id']:n for n in snapshot.get('nodes',[])}
        self.aliases={}
        for node in self.nodes.values():
            for alias in [node.get('routerId'),node.get('lsrId'),node.get('ip'),*node.get('loopbacks',[])]:
                if alias:self.aliases.setdefault(alias,set()).add(node['id'])
        self.interfaces={i['id']:i for i in snapshot.get('interfaces',[])}
        for interface in self.interfaces.values():
            for address in [*interface.get('ipv4',[]),*interface.get('ipv6',[])]:
                try:alias=str(ipaddress.ip_interface(address).ip)
                except ValueError:continue
                self.aliases.setdefault(alias,set()).add(interface['nodeId'])
        self.links={l['id']:l for l in snapshot.get('links',[])}
        self._discover_links()
        self.tunnels={t['id']:dict(t) for t in snapshot.get('tunnels',[])}
        for tunnel in self.tunnels.values():
            tunnel['destination']=tunnel.get('destination') or self.resolve(tunnel.get('destinationRouterId'))
        self.lsps={l['id']:l for l in snapshot.get('lsps',[])}
        self.paths={p['id']:self._resolve_path(p) for p in snapshot.get('paths',[])}
        self.services={s['id']:s for s in snapshot.get('services',[])}
        self.pws={p['id']:p for p in snapshot.get('pws',[])}
        self.bindings=list(snapshot.get('bindings',[]))
        self._bind_pws()

    def resolve(self, alias):
        if alias in self.nodes:return alias
        candidates=self.aliases.get(alias,set())
        return next(iter(candidates)) if len(candidates)==1 else None

    def _discover_links(self):
        by_name={}
        for n in self.nodes.values():by_name.setdefault(n.get('hostname'),[]).append(n['id'])
        by_interface={(i['nodeId'],i['name']):i for i in self.interfaces.values()}
        for a in self.interfaces.values():
            if a.get('logical') or not fresh(a,'lldpPeers',self.at,self.age):continue
            for peer in a.get('lldpPeers',[]):
                targets=by_name.get(peer.get('hostname'),[])
                if len(targets)!=1:continue
                b=by_interface.get((targets[0],peer.get('interface')))
                if not b or b.get('logical') or not fresh(b,'lldpPeers',self.at,self.age):continue
                # Both directions must identify the exact remote interface.
                if not any(p.get('hostname')==self.nodes[a['nodeId']].get('hostname') and p.get('interface')==a['name'] for p in b.get('lldpPeers',[])):continue
                first,second=sorted([a['id'],b['id']]);identifier=f'physical:{first}|{second}'
                if identifier in self.links:continue
                left,right=(a,b) if a['id']==first else (b,a)
                def status(i):
                    if not fresh(i,'physicalStatus',self.at,self.age):return 'unknown'
                    v=str(i.get('physicalStatus')).lower()
                    return 'up' if v in {'1','up'} else 'down' if v in {'2','down'} else 'unknown'
                physical='down' if 'down' in {status(left),status(right)} else 'up' if status(left)==status(right)=='up' else 'unknown'
                self.links[identifier]={'id':identifier,'name':f'{left["nodeId"]} ↔ {right["nodeId"]}','source':left['nodeId'],'target':right['nodeId'],
                    'sourceInterface':left['name'],'targetInterface':right['name'],'capacityBps':min(left.get('capacityBps') or float('inf'),right.get('capacityBps') or float('inf')),
                    'physicalStatus':physical,'observedAt':min(left['observedAt'],right['observedAt']),
                    'dataSource':'snmp','rxBps':left.get('rxBps') if fresh(left,'rxBps',self.at,self.age) else None,
                    'txBps':left.get('txBps') if fresh(left,'txBps',self.at,self.age) else None,'discoveryConfidence':'confirmed'}
                if self.links[identifier]['capacityBps']==float('inf'):self.links[identifier]['capacityBps']=None

    def _resolve_path(self, path):
        result=dict(path);hops=[];issues=[]
        actual=path.get('kind')=='observed' and fresh(path,'hops',self.at,self.age)
        raw=path.get('hops',[])
        if isinstance(raw,str):
            try:raw=json.loads(raw)
            except ValueError:raw=[]
        if not isinstance(raw,list):raw=[];issues.append('Invalid hop array')
        for index,hop in enumerate(raw):
            if not isinstance(hop,(str,dict)):issues.append('Invalid hop record');continue
            h={'routerId':hop} if isinstance(hop,str) else dict(hop)
            h['hopIndex']=index;h['nodeId']=self.resolve(h.get('nodeId') or h.get('routerId'))
            lfib=[l for l in self.lsps.values() if l.get('rawLspKey')==path.get('rawLspKey') and l.get('nodeId')==h['nodeId'] and fresh(l,'outgoingInterface',self.at,self.age)]
            if len(lfib)==1:
                for field in ['incomingInterface','outgoingInterface','nextHop','labelIn','labelOut']:
                    if lfib[0].get(field):h.setdefault(field,lfib[0][field])
            if not h['nodeId']:issues.append(f'Unresolved hop {h.get("routerId")}')
            # RRO may contain both ingress/egress interface addresses on the same router.
            if hops and h['nodeId'] and h['nodeId']==hops[-1]['nodeId']:
                hops[-1].setdefault('addresses',[]).append(h.get('routerId'));continue
            hops.append(h)
        tunnel=self.tunnels.get(path.get('tunnelId'),{})
        endpoints=bool(hops and hops[0]['nodeId']==tunnel.get('source') and hops[-1]['nodeId']==tunnel.get('destination'))
        if not endpoints:issues.append('Path does not explicitly resolve both tunnel endpoints')
        if len([h['nodeId'] for h in hops if h['nodeId']])!=len(set(h['nodeId'] for h in hops if h['nodeId'])):issues.append('Path loop or ambiguous address mapping')
        segments=[]
        for a,b in zip(hops,hops[1:]):
            links=[l for l in self.links.values() if {l['source'],l['target']}=={a['nodeId'],b['nodeId']} and
                (not a.get('outgoingInterface') or (l['sourceInterface'] if l['source']==a['nodeId'] else l['targetInterface'])==a['outgoingInterface'])]
            link=links[0] if len(links)==1 else None
            ospf=[n for n in self.data.get('ospf',[]) if n.get('localNode')==a['nodeId'] and self.resolve(n.get('neighborRouterId'))==b['nodeId'] and
                (not a.get('outgoingInterface') or n.get('interface')==a.get('outgoingInterface')) and fresh(n,'cost',self.at,self.age)]
            cost=ospf[0].get('cost') if len(ospf)==1 else None
            segments.append({'source':a['nodeId'],'target':b['nodeId'],'linkId':link['id'] if link else None,
                'sourceInterface':(link['sourceInterface'] if link['source']==a['nodeId'] else link['targetInterface']) if link else a.get('outgoingInterface'),
                'targetInterface':(link['targetInterface'] if link['source']==a['nodeId'] else link['sourceInterface']) if link else b.get('incomingInterface'),
                'ospfCost':cost,'costSource':ospf[0].get('provenance',{}).get('cost',{}).get('dataSource',ospf[0].get('dataSource')) if len(ospf)==1 else None,
                'costInterface':ospf[0].get('interface') if len(ospf)==1 else None,
                'costObservedAt':ospf[0].get('provenance',{}).get('cost',{}).get('observedAt',ospf[0].get('observedAt')) if len(ospf)==1 else None,
                'capacityBps':link.get('capacityBps') if link else None,'rxBps':link.get('rxBps') if link else None,'txBps':link.get('txBps') if link else None,
                'forwardBps':(link.get('txBps') if link['source']==a['nodeId'] else link.get('rxBps')) if link else None,
                'reverseBps':(link.get('rxBps') if link['source']==a['nodeId'] else link.get('txBps')) if link else None,
                'localIp':ospf[0].get('localIp') if len(ospf)==1 else None,'neighborIp':ospf[0].get('neighborIp') if len(ospf)==1 else None})
            if not link:issues.append(f'Physical interface unresolved for {a["nodeId"]} → {b["nodeId"]}')
        valid_nodes=[h['nodeId'] for h in hops if h['nodeId']]
        result.update(hops=hops,segments=segments,issues=issues,
            dataSource=path.get('provenance',{}).get('hops',{}).get('dataSource',path.get('dataSource')),
            observedAt=path.get('provenance',{}).get('hops',{}).get('observedAt',path.get('observedAt')),
            stale=not fresh(path,'hops',self.at,self.age),actual=actual and endpoints and all(h['nodeId'] for h in hops) and len(valid_nodes)==len(set(valid_nodes)),
            discoveryConfidence='confirmed' if actual and endpoints and not issues else 'incomplete' if issues or not actual else 'inferred')
        return result

    def _bind_pws(self):
        for pw in self.pws.values():
            if not fresh(pw,'outInterface',self.at,self.age):continue
            out=pw.get('outInterface')
            candidates=[t for t in self.tunnels.values() if t.get('source')==pw.get('sourceNode') and
                (out and t.get('name')==out or pw.get('tunnelToken') and t.get('tunnelToken')==pw['tunnelToken'])]
            if len(candidates)!=1:continue
            t=candidates[0]
            if not any(b['pwId']==pw['id'] and b['tunnelId']==t['id'] for b in self.bindings):
                self.bindings.append({'id':f'binding:{pw["id"]}:{t["id"]}','pwId':pw['id'],'tunnelId':t['id'],'active':True,
                    'observedAt':pw.get('provenance',{}).get('outInterface',{}).get('observedAt',pw['observedAt']),
                    'dataSource':pw.get('provenance',{}).get('outInterface',{}).get('dataSource',pw.get('dataSource'))})

    def _pw_paths(self,pw):
        result=[]
        if not fresh(pw,'serviceId',self.at,self.age):return result
        for binding in self.bindings:
            if binding.get('pwId')!=pw['id'] or not true(binding.get('active')) or not fresh(binding,'active',self.at,self.age):continue
            tunnel=self.tunnels.get(binding.get('tunnelId'))
            if not tunnel or tunnel.get('source')!=pw.get('sourceNode') or tunnel.get('destination')!=self.resolve(pw.get('peerRouterId')):continue
            active_lsps=[l for l in self.lsps.values() if l.get('tunnelId')==tunnel['id'] and true(l.get('active')) and fresh(l,'active',self.at,self.age)]
            for lsp in active_lsps:
                matching=[p for p in self.paths.values() if p.get('tunnelId')==tunnel['id'] and p.get('lspId')==lsp['id']]
                if not matching:
                    result.append({'pwId':pw['id'],'tunnelId':tunnel['id'],'lspId':lsp['id'],'pathId':None,'discoveryConfidence':'incomplete','issues':['Active LSP has no actual hop record']})
                for path in matching:
                    result.append({'pwId':pw['id'],'tunnelId':tunnel['id'],'lspId':lsp['id'],'pathId':path['id'],'lspRole':lsp.get('role'),
                        'distributionPercent':binding.get('distributionPercent') if binding.get('distributionMeasured') is True else None,
                        'discoveryConfidence':path['discoveryConfidence'],'path':path,'dataSource':binding.get('dataSource'),'observedAt':binding.get('observedAt')})
        return result

    def service_path(self,service_id):
        service=self.services.get(service_id)
        if not service:return None
        forward=[];reverse=[];issues=[]
        local=self.nodes.get(service.get('localNode'),{})
        peers=[pw for pw in self.pws.values() if pw.get('serviceId')==service_id]
        for pw in peers:
            forward.extend(self._pw_paths(pw))
            remote=self.resolve(pw.get('peerRouterId'))
            counterparts=[other for other in self.pws.values() if other.get('sourceNode')==remote and self.resolve(other.get('peerRouterId'))==local.get('id') and
                str(other.get('vcId'))==str(pw.get('vcId'))]
            if len(counterparts)==1:reverse.extend(self._pw_paths(counterparts[0]))
            else:issues.append(f'Reverse PW unresolved or ambiguous for {pw["id"]}')
        if not forward:issues.append('Forward active PW → tunnel → LSP → actual path is incomplete')
        if not reverse:issues.append('Reverse path not confirmed; symmetry is not assumed')
        actual_forward=[p['path'] for p in forward if p.get('path',{}).get('actual')]
        actual_reverse=[p['path'] for p in reverse if p.get('path',{}).get('actual')]
        # Asymmetry is stated only for a unique, complete path in each direction.
        asymmetric=None
        if len(actual_forward)==1 and len(actual_reverse)==1:
            if [h['nodeId'] for h in actual_forward[0]['hops']]!=list(reversed([h['nodeId'] for h in actual_reverse[0]['hops']])):asymmetric=True
            else:
                a=[s.get('linkId') for s in actual_forward[0]['segments']];b=[s.get('linkId') for s in actual_reverse[0]['segments']]
                if all(a) and all(b):asymmetric=a!=list(reversed(b))
        return {'vsi':service,'forward':forward,'reverse':reverse,'asymmetric':asymmetric,'multipleActivePaths':len(actual_forward)>1 or len(actual_reverse)>1,
            'issues':issues,'discoveryConfidence':'confirmed' if forward and reverse and not issues and all(p.get('discoveryConfidence')=='confirmed' for p in [*forward,*reverse]) else 'incomplete'}

    def impact(self,link_id):
        tunnels=set();services=set()
        for sid in self.services:
            analysis=self.service_path(sid)
            for record in [*analysis['forward'],*analysis['reverse']]:
                path=record.get('path',{})
                if path.get('actual') and any(s.get('linkId')==link_id for s in path.get('segments',[])):
                    services.add(sid);tunnels.add(record['tunnelId'])
        return {'linkId':link_id,'tunnelIds':sorted(tunnels),'serviceIds':sorted(services),'basis':'fresh observed active dependencies of local VSI instances; uncollected services are unknown'}

    def grafana_rows(self):
        output={f'jtopology_{key}':rows for key,rows in self.data.items() if isinstance(rows,list)}
        output['jtopology_links']=list(self.links.values())
        output['jtopology_tunnels']=list(self.tunnels.values())
        for tunnel in output['jtopology_tunnels']:
            for role,field in [('primary','primaryPath'),('backup','backupPath')]:
                lsp_id=tunnel.get('primaryLsp' if role=='primary' else 'backupLsp')
                matches=[p for p in self.paths.values() if p.get('lspId')==lsp_id and p.get('tunnelId')==tunnel['id']]
                if len(matches)==1:
                    p=matches[0]
                    tunnel[field]={'hops':[h.get('nodeId') or h.get('routerId') for h in p['hops']],
                        'kind':p['kind'],'observedAt':p.get('provenance',{}).get('hops',{}).get('observedAt',p['observedAt'])}
                    if all(s.get('linkId') for s in p['segments']):tunnel[field]['linkIds']=[s['linkId'] for s in p['segments']]
        output['jtopology_paths']=list(self.paths.values())
        output['jtopology_bindings']=self.bindings
        output['jtopology_service_paths']=[{'id':sid,**self.service_path(sid)} for sid in self.services]
        critical={'nodes':'snmpStatus','links':'physicalStatus','ospf':'state','tunnels':'operStatus'}
        for kind,field in critical.items():
            for row in output.get(f'jtopology_{kind}',[]):
                row['observedAt']=row.get('provenance',{}).get(field,{}).get('observedAt',row.get('observedAt'))
                if kind=='ospf':
                    row['costObservedAt']=row.get('provenance',{}).get('cost',{}).get('observedAt',row.get('observedAt'))
                    row['costSource']=row.get('provenance',{}).get('cost',{}).get('dataSource',row.get('dataSource'))
        # JSON strings survive SQL/Infinity table transformations without losing nested structures.
        return {name:[{k:json.dumps(v,sort_keys=True) if isinstance(v,(dict,list)) else v for k,v in row.items()} for row in rows]
            for name,rows in output.items()}
