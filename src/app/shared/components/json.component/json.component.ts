import { Component, inject, input, output, OnInit, PLATFORM_ID, effect } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { JsonEditorComponent, JsonEditorOptions } from 'ang-jsoneditor';

@Component({
  selector: 'app-json-component',
  imports: [JsonEditorComponent, ReactiveFormsModule],
  templateUrl: './json.component.html',
  styleUrl: './json.component.css',
  host: {
    class: 'w-full h-full block'
  }
})
export class JsonComponent implements OnInit {
  private platformId = inject(PLATFORM_ID);
  data = input<any>();
  readOnly = input<boolean>(false);
  dataChange = output<any>();

  public editorOptions!: JsonEditorOptions;
  private readonly formBuilder = inject(FormBuilder);
  formInput!: FormGroup;

  constructor() {
    effect(() => {
      const currentData = this.data();
      if (this.formInput) {
        // Only update if the form value is different from input to avoid cycles
        let parsedData = currentData;
        if (typeof currentData === 'string') {
          try { parsedData = JSON.parse(currentData); } catch (e) {}
        }
        
        const currentFormValue = this.formInput.get('dataInput')?.value;
        if (JSON.stringify(parsedData) !== JSON.stringify(currentFormValue)) {
          this.formInput.get('dataInput')?.setValue(parsedData, { emitEvent: false });
        }
      }
    });
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.createFormInput();
      this.makeOptions();
    }
  }

  createFormInput() {
    let initialData = this.data();
    if (typeof initialData === 'string') {
      try {
        initialData = JSON.parse(initialData);
      } catch (e) {
        // Keep as string if not valid JSON
      }
    }
    
    this.formInput = this.formBuilder.group({
      dataInput: [initialData]
    });
    
    // Listen for changes
    this.formInput.get('dataInput')?.valueChanges.subscribe(val => {
      this.dataChange.emit(val);
    });
  }

  makeOptions() {
    this.editorOptions = new JsonEditorOptions();
    this.editorOptions.mode = 'code';
    this.editorOptions.mainMenuBar = false;
    this.editorOptions.onEditable = () => !this.readOnly();
    return this.editorOptions;
  }

  getData(event: any) {
    // console.log(event);
  }

  submitData() {
    console.log(this.formInput.value);
  }
}
