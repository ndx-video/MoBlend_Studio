export namespace store {
	
	export class InstalledTemplate {
	    TemplateID: string;
	    LocalPath: string;
	    CatalogVersion: string;
	    // Go type: time
	    InstalledAt: any;
	
	    static createFrom(source: any = {}) {
	        return new InstalledTemplate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.TemplateID = source["TemplateID"];
	        this.LocalPath = source["LocalPath"];
	        this.CatalogVersion = source["CatalogVersion"];
	        this.InstalledAt = this.convertValues(source["InstalledAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

