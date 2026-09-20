import {MAX_SELECTED_TEXT,reviewSelectedProjectText,selectedIntakeFields} from '../assets/blueprint-selected-text.js';

/** Explicit, private, local-only text preparation. No account or file scanning. */
export function mountSelectedText(root, onUse, onClose) {
  let disposed=false, review=null;
  const selected=new Set();
  root.innerHTML='<h3>Start with what you have</h3><p>Paste the project details you choose. Review them here before saving. No inbox is connected or scanned.</p><p class="hint">Remove private or banking details first. Clear labels such as Project:, Location: and Scope: work best.</p><label class="field"><span>Selected project text</span><textarea id="selected-text-input" rows="7" placeholder="Project: Studio refresh&#10;Location: Example site&#10;Scope: Improve storage and access."></textarea></label><p id="selected-text-count" class="hint"></p><button id="find-project-details" class="btn quiet" type="button">Find project details</button><div id="selected-text-review" aria-live="polite"></div><div class="brief-actions"><button id="use-selected-details" class="btn" type="button" hidden>Use selected details</button><button id="close-selected-text" class="btn quiet" type="button">Close text review</button></div>';
  const find=s=>root.querySelector(s), input=find('#selected-text-input'), list=find('#selected-text-review'), use=find('#use-selected-details');
  input.maxLength=MAX_SELECTED_TEXT+1;
  const text=(tag,value,parent)=>{const node=document.createElement(tag);node.textContent=value;parent.append(node);return node;};
  function change(){review=null;selected.clear();list.replaceChildren();use.hidden=true;find('#selected-text-count').textContent=input.value.length.toLocaleString()+' / 20,000 characters · not saved';find('#find-project-details').disabled=!input.value.trim();}
  function analyse(){
    if(disposed)return;
    review=reviewSelectedProjectText(input.value);selected.clear();list.replaceChildren();
    text('p',review.message,list);
    for(const item of review.suggestions){
      selected.add(item.key);
      const label=document.createElement('label');label.className='intake-option';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=true;checkbox.setAttribute('aria-label','Use '+item.label.toLowerCase());
      checkbox.addEventListener('change',()=>{if(checkbox.checked)selected.add(item.key);else selected.delete(item.key);use.disabled=!selected.size;});
      label.append(checkbox);const copy=document.createElement('span');copy.className='intake-copy';
      text('strong',item.label,copy);text('span',item.value,copy);text('small','From line '+item.sourceLine+' of your selection',copy);label.append(copy);list.append(label);
    }
    for(const warning of review.warnings)text('p',warning,list);
    use.hidden=review.state!=='review';use.disabled=!selected.size;
  }
  input.addEventListener('input',change);find('#find-project-details').addEventListener('click',analyse);
  use.addEventListener('click',()=>{if(disposed||!review||!selected.size)return;const values=selectedIntakeFields(review,[...selected]);if(Object.keys(values).length)onUse(values);});
  find('#close-selected-text').addEventListener('click',()=>{if(!disposed&&(!input.value||window.confirm('Discard the pasted text? Nothing has been uploaded.')))onClose();});
  change();input.focus();
  return {dirty:()=>!disposed&&input.value.length>0,dispose(){disposed=true;input.value='';review=null;selected.clear();root.replaceChildren();}};
}
