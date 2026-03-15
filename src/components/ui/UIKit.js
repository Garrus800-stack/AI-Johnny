/**
 * UIKit — Wiederverwendbare UI-Komponenten für Johnny
 * Extrahiert aus der monolithischen App.jsx
 */
'use strict';

var e = React.createElement;

var S = {
  input: { width:'100%', background:'var(--bg-tertiary)', border:'1px solid var(--border-color)',
    borderRadius:'8px', padding:'9px 12px', color:'var(--text-primary)', fontSize:'14px',
    fontFamily:'inherit', outline:'none', boxSizing:'border-box' }
};

function DInput(props) {
  return e('input', {
    type: props.type||'text', value: props.value||'', placeholder: props.placeholder,
    onChange: function(ev){ props.onChange(ev.target.value); },
    style: Object.assign({}, S.input, props.style||{})
  });
}

function DTextArea(props) {
  return e('textarea', {
    value: props.value||'', placeholder: props.placeholder, rows: props.rows||4,
    onChange: function(ev){ props.onChange(ev.target.value); },
    style: Object.assign({}, S.input, { resize:'vertical', minHeight:'60px' }, props.style||{})
  });
}

function DSelect(props) {
  return e('select', {
    value: props.value||'', onChange: function(ev){ props.onChange(ev.target.value); },
    style: Object.assign({}, S.input, { cursor:'pointer' }, props.style||{})
  },
    props.placeholder ? e('option',{value:''},props.placeholder) : null,
    (props.options||[]).map(function(o){
      return e('option',{key:o.value,value:o.value},o.label);
    })
  );
}

function DField(props) {
  return e('div',{style:{marginBottom:'14px'}},
    e('label',{style:{display:'block',marginBottom:'5px',fontSize:'12px',
      fontWeight:'600',color:'var(--text-secondary)',textTransform:'uppercase',letterSpacing:'0.5px'}},props.label),
    props.children,
    props.hint ? e('div',{style:{fontSize:'11px',color:'var(--warning)',marginTop:'4px'}},props.hint) : null
  );
}

function DModal(props) {
  return e('div',{style:{
    position:'fixed',top:0,left:0,width:'100vw',height:'100vh',
    background:'rgba(0,0,0,0.85)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999
  }, onClick: function(ev){ if(ev.target === ev.currentTarget && props.onClose) props.onClose(); }},
    e('div',{style:{
      background:'var(--bg-secondary)',border:'1px solid var(--accent-primary)',
      borderRadius:'16px',padding:'28px 32px',width:props.width||'500px',
      maxWidth:'92vw',maxHeight:'88vh',overflowY:'auto'
    }},
      e('div',{style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'20px'}},
        e('h2',{style:{margin:0,fontFamily:'JetBrains Mono, monospace',fontSize:'16px'}},props.title),
        e('button',{onClick:props.onClose,style:{background:'none',border:'none',
          color:'var(--text-secondary)',fontSize:'22px',cursor:'pointer',lineHeight:1}},'×')
      ),
      props.children
    )
  );
}

function DBtn(props) {
  return e('button',{
    onClick: props.onClick, disabled: !!props.disabled,
    className: props.primary ? 'btn btn-primary' : 'btn',
    style: Object.assign(
      { padding: props.small?'6px 14px':'9px 20px', fontSize: props.small?'12px':'14px',
        cursor: props.disabled?'not-allowed':'pointer', opacity: props.disabled?0.5:1 },
      props.danger ? { borderColor:'#e74c3c', color:'#e74c3c' } : {},
      props.style||{}
    )
  }, props.label || props.children);
}

function DChip(props) {
  return e('button',{
    onClick: props.onClick,
    style:{
      background: props.active?'var(--accent-primary)':'var(--bg-tertiary)',
      color: props.active?'#000':'var(--text-primary)',
      border:'1px solid '+(props.active?'var(--accent-primary)':'var(--border-color)'),
      borderRadius:'20px',padding:'3px 12px',cursor:'pointer',
      fontSize:'12px',fontFamily:'JetBrains Mono, monospace',fontWeight:props.active?'700':'400'
    }
  },props.label);
}

function DSection(props) {
  return e('div',{style:Object.assign({marginBottom:'24px'},props.style||{})},
    props.title ? e('h3',{style:{margin:'0 0 12px 0',fontSize:'14px',fontFamily:'JetBrains Mono, monospace',
      color:'var(--text-primary)',borderBottom:'1px solid var(--border-color)',paddingBottom:'8px'}},props.title) : null,
    props.children
  );
}

function DCard(props) {
  return e('div',{style:Object.assign({
    background:'var(--bg-tertiary)',border:'1px solid var(--border-color)',
    borderRadius:'12px',padding:'16px',marginBottom:'12px'
  },props.style||{}), onClick: props.onClick},
    props.children
  );
}

function DGrid(props) {
  return e('div',{style:{
    display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax('+(props.minWidth||'280px')+',1fr))',
    gap: props.gap||'12px'
  }}, props.children);
}

function DInfoRow(props) {
  return e('div',{style:{display:'flex',justifyContent:'space-between',padding:'4px 0',fontSize:'13px'}},
    e('span',{style:{color:'var(--text-secondary)'}},props.label),
    e('span',{style:{color:props.color||'var(--text-primary)',fontWeight:'500'}},props.value)
  );
}

module.exports = { DInput, DTextArea, DSelect, DField, DModal, DBtn, DChip, DSection, DCard, DGrid, DInfoRow, S };
