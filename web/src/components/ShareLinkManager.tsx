import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { formatDate } from '../i18n'
import type { Demo, ShareLink } from '../types'
import Icon from './Icon'

export default function ShareLinkManager({demo}:{demo:Demo}){
  const{t}=useTranslation(['editor','common']),[items,setItems]=useState<ShareLink[]>([]),[creating,setCreating]=useState(false),[name,setName]=useState(''),[expires,setExpires]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const load=()=>api.shareLinks(demo.id).then(setItems).catch(value=>setError(value.message))
  useEffect(()=>{if(demo.share_url)void load();else setItems([])},[demo.id,demo.share_url])
  async function create(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');try{await api.createShareLink(demo.id,{name,expires_at:expires?new Date(expires).toISOString():null,password});setName('');setExpires('');setPassword('');setCreating(false);await load()}catch(value){setError(value instanceof Error?value.message:t('common:errors.operationFailed'))}finally{setBusy(false)}}
  async function toggle(item:ShareLink){setBusy(true);try{await api.updateShareLink(demo.id,item.id,{revoked:!item.revoked});await load()}finally{setBusy(false)}}
  if(!demo.share_url)return null
  return <div className="share-manager"><header><span>{t('shareManager.links',{count:items.length})}</span><button className="icon-button" onClick={()=>setCreating(value=>!value)}><Icon name={creating?'close':'plus'}/>{t(creating?'shareManager.cancel':'shareManager.create')}</button></header>{creating&&<form onSubmit={create}><label>{t('shareManager.name')}<input value={name} onChange={event=>setName(event.target.value)} placeholder={t('shareManager.namePlaceholder')}/></label><label>{t('shareManager.expires')}<input type="datetime-local" value={expires} onChange={event=>setExpires(event.target.value)}/></label><label>{t('shareManager.password')}<input type="password" value={password} onChange={event=>setPassword(event.target.value)} placeholder={t('shareManager.passwordHint')}/></label><button className="primary" disabled={busy}>{busy?t('shareManager.creating'):t('shareManager.createLink')}</button></form>}{error&&<small className="error">{error}</small>}<div className="share-manager-list">{items.map(item=><article key={item.id} className={item.revoked||item.expired?'inactive':''}><span><Icon name={item.password_protected?'lock':'link'}/></span><div><strong>{item.name||t('shareManager.unnamed')}</strong><small>{item.expires_at?t('shareManager.expiresAt',{date:formatDate(item.expires_at)}):t('shareManager.neverExpires')} · {t('shareManager.visits',{count:item.access_count})}</small></div><button title={t('common:actions.copy')} onClick={()=>navigator.clipboard.writeText(item.url)}><Icon name="copy"/></button><button disabled={busy} title={t(item.revoked?'shareManager.restore':'shareManager.revoke')} onClick={()=>toggle(item)}><Icon name={item.revoked?'link':'unlink'}/></button></article>)}</div></div>
}
