import { afterNextRender, Component, signal, ViewChild, ViewContainerRef } from '@angular/core';
import { JsonEditorComponent, JsonEditorOptions } from 'ang-jsoneditor';

@Component({
  selector: 'app-json-component',
  imports: [JsonEditorComponent],
  templateUrl: './json.component.html',
  styleUrl: './json.component.css',
})
export class JsonComponent {
  public editorOptions!: JsonEditorOptions;
  public data: any = signal({});
  // optional
  @ViewChild(JsonEditorComponent, { static: false })
  editor!: JsonEditorComponent;

  constructor() {
    this.data.set({ "products": [{ "name": "car", "product": [{ "name": "honda", "model": [{ "id": "civic", "name": "civic" }, { "id": "accord", "name": "accord" }, { "id": "crv", "name": "crv" }, { "id": "pilot", "name": "pilot" }, { "id": "odyssey", "name": "odyssey" }] }] }] });

    afterNextRender(async () => {
      // Wait for fonts to be ready
      if ('fonts' in document) {
        try {
          await (document as any).fonts.ready;
        } catch (e) {
          console.warn('Font loading check failed:', e);
        }
      }

      // Small delay to ensure browser has rendered fonts
      setTimeout(() => {
        if (this.editor && this.editor.getEditor) {
          try {
            const aceEditor = this.editor.getEditor();
            // Force re-calculation of character widths
            aceEditor.setOptions({
              fontFamily: "'Source Code Pro', 'Fira Code', monospace",
              fontSize: "12px"
            });
            // Critical for font loading issues
            (aceEditor.renderer as any).updateCharacterSize();
            aceEditor.resize(true);
            aceEditor.renderer.updateFull();
          } catch (e) {
            console.warn('Could not resize editor:', e);
          }
        }
      }, 300);
    });
  }

  makeOptions = () => {
    this.editorOptions = new JsonEditorOptions()
    // this.editorOptions.modes = ['code', 'text', 'tree', 'view']; // set all allowed modes
    this.editorOptions.mode = 'code';
    this.editorOptions.mainMenuBar = false;

    return this.editorOptions;
  }

  getData(event: any) {
    console.log(event);
  }

}
