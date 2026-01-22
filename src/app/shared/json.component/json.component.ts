import { Component, inject, input, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { JsonEditorComponent, JsonEditorOptions } from 'ang-jsoneditor';

@Component({
  selector: 'app-json-component',
  imports: [JsonEditorComponent, ReactiveFormsModule],
  templateUrl: './json.component.html',
  styleUrl: './json.component.css',
})
export class JsonComponent implements OnInit {

  ngOnInit(): void {
    this.createFormInput();
    this.makeOptions();
  }


  public editorOptions!: JsonEditorOptions;
  data = input<any>();
  readOnly = input<boolean>(false);

  private readonly formBuilder = inject(FormBuilder);

  formInput!: FormGroup;
  createFormInput() {
    this.formInput = this.formBuilder.group({
      dataInput: [this.data()]
    })
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
